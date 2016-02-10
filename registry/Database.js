'use strict'

import PouchDB from 'pouchdb'
import Config from './config.json'

const db = new PouchDB(Config.pouchLocation)

export async function add(type, id, data) {
    try {
        const stored = await db.put({ _id: type + '/' + id, data })
        return { id: stored.id.split(type + '/')[1], rev: stored.rev }
    }
    catch (e) {
        if (e.name === 'conflict') {
            const match = id.match(/(.*-)(\d+)$/)
            const newID = match ? match[1] + (Number(match[2]) + 1) : id + '-1'
            return add(data, type, newID)
        }       
    }
}

export async function update(type, id, data, rev) {
    const stored = await db.put({ _id: type + '/' + id, _rev: rev, data })
    return { id: stored.id.split(type + '/')[1], rev: stored.rev }
}

export async function retrieve(type, id) {
    const item = await db.get(type + '/' + id)
    return Object.assign({ id }, item.data)
}

export async function retrieveAll(type) {
    const documents = await db.allDocs({ startkey: type + '/\uffff', endkey: type + '/', include_docs: true, descending: true })
    return documents.rows.map(row => {
        return Object.assign({ id: row.id.replace(type + '/', '') }, row.doc.data)
    })
}

export async function remove(type, id) {
    const document = await db.get(type + '/' + id)
    return db.remove(document)
}