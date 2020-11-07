Newsagent
=========

Monitor data sources, get alerted when they change.


Installing
----------

    $ npm install -g newsagent

Alternatively, don't install it and just prepend the command with `npx`.


Usage
-----

    $ newsagent <watchfiles...>

Where `<watchfiles...>` are names of one or more watchfiles.


### Watchfiles

A watchfile defines how a data source should be monitored, what transforms to apply to those changes, and when to fire alerts. They are written in Yaml. An example:

    name: AP Politics Twitter

    source:
        method: fetch-html
        url: 'https://twitter.com/search?f=live&q=from:AP_Politics'
        browser: chromium
        selection: 'article div[lang="en"]'

    schedule: 10s

    monitor: additions-only

    processes:
        - method: match-transform
          match: 'BREAKING: ([A-Za-z]+) ([A-Za-z ]+) wins (.+) to (.+) in (.+)\. #APracecall at (.+)\.'
          transform: '\\4: \\5 -- \\3 of \\2 (\\1) at \\6'
        - method: find-and-replace
          find: 'U.S.'
          replace: 'US'

    alerts:
        - method: log

A watchfile can also have a top-level array with multiple watches.

The sections:

<hr>

#### `name`

A unique name for this watchfile.

<hr>

#### `source`

Where the data is going to come from. The `method` field should be one of the following source methods. The other source fields are specified by the method.

##### ► `fetch-html`

Fetch a HTML page, and extract text from it.

* `url` The URL to fetch
* `browser` (optional) If not specified simply fetches the HTML, specify either `chromium`, `webkit`, or `firefox` to fetch the page using that browser
* `selection` A CSS selector for one or more text elements, or the more advanced [Playwright format](https://playwright.dev/#path=docs/selectors.md) if a browser is specified

<hr>

#### `schedule`

How often to check for changes. Supports [various human-readable formats](https://github.com/breejs/bree#job-interval-and-timeout-values).

<hr>

#### `monitor`

What kinds of changes do you want to be alerted on? Set to either `additions-and-removals`, `additions-only`, or `removals-only`.

<hr>

#### `processes`

An optional section. A list of processes which the changes are pushed through, one after another. They can modify or filter out what goes through to fire alerts.

##### ► `match-transform`

Expects text input, and outputs text. If it matches the regular expression in the `match` section it goes through to the `transform`.

* `match` A regular expression
* `transform` Text to output, using groups from the match, eg. `\\1`

##### ► `find-and-replace`

Expects text input, and outputs text. Looks for text and replaces it with something else.

* `find` The text to look for.
* `replace` What to replace it with.

<hr>

#### `alerts`

A list of alerts to fire for all changes that have made it this far.

##### ► `log`

Just prints to the console.

##### ► `email`

Sends an email.

* `to` The email address to send to.
* `smtpHost` The host name of the SMTP server (for a Gmail account, use `smtp.gmail.com`)
* `smtpUsername` Your SMTP username (for a Gmail account, use your email address)
* `smtpPassword` Your SMTP password (for a Gmail account, use [an app password](https://myaccount.google.com/apppasswords))

<hr>


Inspiration
-----------

* [Some unnamed tool built by the LA Times](https://www.youtube.com/watch?v=iP-On8PzEy8)
* [Morph](https://morph.io/)
* [Huginn](https://github.com/huginn/huginn)
* [Visualping](https://visualping.io/), nee Change Detection
* [Stakeout](https://github.com/veltman/stakeout)
* [Datawire](https://github.com/arc64/datawi.re)
* [Datastringer](https://github.com/BBC-News-Labs/datastringer)
* [Yahoo Pipes](https://en.wikipedia.org/wiki/Yahoo!_Pipes)
