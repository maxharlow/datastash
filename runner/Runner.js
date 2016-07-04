'use strict'

import Promisify from 'promisify-node'
import FS from 'fs'
import Path from 'path'
import Process from 'process'
import ChildProcess from 'child_process'
import Schedule from 'node-schedule'
import NeatCSV from 'neat-csv'
import DeepEqual from 'deep-equal'
import Nodemailer from 'nodemailer'
import * as Database from './Database'
import * as Email from './Email'
import Config from './config.json'

export async function setup(filename) {
    const id = Path.parse(filename).name
    const dateStarted = new Date()
    const data = await Promisify(FS.readFile)(filename)
    const recipe = JSON.parse(data.toString())
    await Database.add('system', 'recipe', recipe)
    await Promisify(FS.mkdir)(Config.sourceLocation)
    const results = await sequentially(shell(Config.sourceLocation), recipe.setup)
    results.forEach(result => {
        result.log.forEach(message => {
            if (message.type === 'stderr') Process.stderr.write(message.value)
            else if (message.type == 'stdout') Process.stdout.write(message.value)
        })
    })
    const isFailure = messages.some(message => message.type === 'failure')
    Process.exit(isFailure ? 1 : 0)
}

export async function schedule() {
    Object.keys(Schedule.scheduledJobs).forEach(Schedule.cancelJob)
    const recipe = await Database.retrieve('system', 'recipe')
    if (recipe.schedule) {
        const job = Schedule.scheduleJob(recipe.schedule, () => enqueue('scheduled'))
        if (job === null) throw new Error('Scheduling failed! Is the crontab valid?')
    }
}

export async function enqueue(initiator) {
    const runs = await Database.retrieveAll('run')
    const runsIdenticalQueued = runs.filter(run => run.state === 'queued' && run.initiator === initiator)
    if (runsIdenticalQueued.length > 0) return
    const dateQueued = new Date().toISOString()
    const run = {
        state: 'queued',
        initiator,
        dateQueued
    }
    Database.add('run', dateQueued, run)
}

async function pluck() {
    const runs = await Database.retrieveAll('run', true)
    const isRunning = runs.find(run => run.state === 'running')
    const runsQueued = runs.filter(run => run.state === 'queued')
    if (isRunning || runsQueued.length === 0) return
    else run(runsQueued[0].id)
}

export async function dequeue() {
    setInterval(pluck, 10 * 1000) // in milliseconds
}

export async function describe() {
    const recipe = await Database.retrieve('system', 'recipe')
    const runs = await Database.retrieveAll('run')
    const runsFinished = runs.filter(run => run.state !== 'queued' && run.state !== 'running')
    const runsSuccessful = runs.filter(run => run.state === 'success')
    const status = {
        numberRuns: runsFinished.length,
        numberRunsSuccessful: runsSuccessful.length,
        successRate: Math.round((runsSuccessful.length / runsFinished.length * 100) * 10) / 10,
        averageRunTime: runsFinished.reduce((a, run) => a + run.duration, 0) / runsFinished.length,
        dateLastSuccessfulRun: runsSuccessful.length > 0 ? runsSuccessful[0].date : null
    }
    return { recipe, status }
}

export async function modify(recipeNew) {
    const recipeCurrent = await Database.retrieve('system', 'recipe', true)
    return Database.update('system', 'recipe', recipeNew, recipeCurrent.rev).then(schedule)
}

export async function difference(id) {
    const data = await Database.retrieveAll('data', true) // note only successful runs store data
    const index = data.findIndex(d => d.id === id)
    if (index === data.length - 1) return { added: [], removed: [] } // it's the first set of data we have
    const current = data[index].rows.map((item, _i) => Object.assign({ _i }, item))
    const previous = data[index + 1].rows.map((item, _i) => Object.assign({ _i }, item))
    const added = current.filter(currentItem => { // current items not in previous
        return !previous.some(previousItem => DeepEqual(currentItem, previousItem))
    })
    const removed = previous.filter(previousItem => { // previous items not in current
        return !current.some(currentItem => DeepEqual(previousItem, currentItem))
    })
    return {
        added: added.map(item => { delete item._i; return item }),
        removed: removed.map(item => { delete item._i; return item })
    }
}

async function run(id) {
    const queued = await Database.retrieve('run', id, true)
    const dateStarted = new Date()
    const runRunning = {
        state: 'running',
        initiator: queued.initiator,
        dateQueued: queued.dateQueued,
        dateStarted: dateStarted.toISOString()
    }
    const running = await Database.update('run', id, runRunning, queued.rev)
    const recipe = await Database.retrieve('system', 'recipe')
    const execution = await sequentially(shell(Config.sourceLocation), recipe.run)
    const isFailure = execution.some(entry => entry.code > 0)
    if (isFailure) {
        const runFailure = {
            state: 'failure',
            initiator: queued.initiator,
            dateQueued: queued.dateQueued,
            dateStarted: dateStarted.toISOString(),
            duration: new Date() - dateStarted,
            execution
        }
        Database.update('run', id, runFailure, running.rev)
    }
    else {
        const rows = await csv(Config.sourceLocation + '/' + recipe.result)
        const data = { rows }
        await Database.add('data', id, data)
        const diff = await difference(id)
        const triggered = await trigger(diff, recipe.triggers, recipe.name)
        const runSuccess = {
            state: 'success',
            initiator: queued.initiator,
            dateQueued: queued.dateQueued,
            dateStarted: dateStarted.toISOString(),
            duration: new Date() - dateStarted,
            recordsAdded: diff.added.length,
            recordsRemoved: diff.removed.length,
            execution,
            triggered
        }
        await Database.update('run', id, runSuccess, running.rev)
        removeOldRuns()
    }
}

async function removeOldRuns() {
    const runs = await Database.retrieveAll('run', true)
    if (runs.length <= Config.storedRuns) return
    runs.slice(Config.storedRuns).forEach(run => {
        Database.remove('run', run.id)
        if (run.state === 'success') Database.remove('data', run.id)
    })
}

async function csv(location) {
    const data = await Promisify(FS.readFile)(location)
    return NeatCSV(data)
}

function trigger(diff, triggers, name) {
    const responses = triggers.map(trigger => {
        return (diff.added.length > 0 || diff.removed.length > 0) ? Email.send(trigger.recipient, name, Email.format(diff, name)) : null
    })
    return Promise.all(responses.filter(Boolean))
}

function sequentially(fn, array, a = []) {
    return fn(array[0])
        .then(data => array.length > 1 ? sequentially(fn, array.splice(1), a.concat(data)) : a.concat(data))
        .catch(data => a.concat(data))
}

function shell(location) {
    const path = Path.resolve(location)
    return command => {
        var log = []
        const process = ChildProcess.exec(command, { cwd: path })
        process.stdout.on('data', data => log.push({ type: 'stdout', value: data }))
        process.stderr.on('data', data => log.push({ type: 'stderr', value: data }))
        return new Promise((resolve, reject) => {
            process.on('exit', code => {
                const result = { command, code, log }
                if (code > 0) reject(result)
                else resolve(result)
            })
        })
    }
}
