'use strict'

const {promisify} = require('util')

const dorita980 = require('dorita980')
const pTimeout = require('p-timeout')

const DEFAULT_TIMEOUT = 3000

const COMMANDS = {
    DOCK: 'dock',
    PAUSE: 'pause',
    RESUME: 'resume',
    START: 'start',
    STOP: 'stop'
}

const FIELDS_INIT = [
    'hwPartsRev'
  , 'sku'
]

const FIELDS_STATUS = [
    'batPct'
  , 'bin'
  , 'cleanMissionStatus'
  , 'lastCommand'
]

const isValidCommand = function(command) {
    return Object.values(COMMANDS).includes(command)
}

const timedPromise = function (promise, timeout = DEFAULT_TIMEOUT) {
    return pTimeout(promise, timeout)
}

class RoombaConnect {
    constructor(log, config) {
        const {blid, ip, robotpwd} = config
        if (!blid) {
            throw new Error('No blid provided!')
        }
        if (!robotpwd) {
            throw new Error('No robotpwd provided!')
        }
        this.blid = blid
        this.ip = ip
        this.log = log
        this.robotpwd = robotpwd
        this.connected = false
    }

    static COMMANDS = COMMANDS

    async getRoomba() {
        const {blid, ip, robotpwd} = this
        if (!ip) {
            console.log('No IP specified, attempting IP lookup...')
            try {
                ip = await timedPromise(
                    promisify(dorita980.getRobotIP)()
                )
            } catch (error) {
                console.log(`Failed to look up roomba IP: ${error}`)
            }
            // if (!ip) {
            //     console.log('No IP found!')
            //     return null
            // }
            console.log(`Found roomba at IP address: ${ip}`)
        }
        const roomba = new dorita980.Local(blid, robotpwd, ip)
        roomba.on('connect', () => {
            this.connected = true
            console.log('connected!')
        })
        roomba.on('close', () => {
            this.connected = false
            console.log('disconnected!')
        })
        return roomba
    }

    async init() {
        const connect = this
        let state
        try {
            const roomba = await connect.getRoomba()
            this.roomba = roomba
            console.log(`Syncing initial state for Roomba blid ${connect.blid}...`)
            state = await timedPromise(
                roomba.getRobotState([...FIELDS_INIT, ...FIELDS_STATUS])
            )
        } catch (error) {
            console.log(`Error initializing Roomba with blid ${connect.blid}: ${error}`)
            return null
        }
        if (!state) {
            console.log('Falsy initial state received, returning null...')
            return null
        }
        return state
    }

    isConnected() {
        if (!this.connected) {
            console.log(`Roomba with blid ${this.blid} not connected, try again later.`)
            return false
        }
        return true
    }

    async sync() {
        const {blid, roomba} = this
        if (!this.isConnected()) {
            return null
        }
        console.log(`Syncing state for Roomba blid ${blid}...`)
        let state
        try {
            state = await timedPromise(
                roomba.getRobotState(FIELDS_STATUS)
            )
        } catch (error) {
            console.log(`Error syncing Roomba state with blid ${blid}: ${error}`)
            return null
        }
        if (!state) {
            console.log(`Falsy state received for Roomba with blid ${blid}, returning null...`)
            return null
        }
        return state
    }

    async sendBasicCommand(command) {
        if (!isValidCommand(command)) {
            throw new Error(`Invalid command: ${command}`)
        }
        if (!this.isConnected) {
            return false
        }
        const {blid, roomba} = this
        console.log(`Sending ${command} command to Roomba with blid ${blid}`)
        try {
            await timedPromise(roomba[command]())
            // Issue dock command after roomba is stopped
            if (command === COMMANDS.STOP) {
                await timedPromise(roomba[COMMANDS.DOCK])
            }
        } catch (error) {
            console.log(`Error sending command to Roomba with blid ${blid}: ${error}`)
            return false
        }
        return true
    }

    disconnect() {
        if (this.isConnected()) {
            this.roomba.end()
            this.connected = false
            this.roomba = null
        }
    }
}

module.exports = RoombaConnect
