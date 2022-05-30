'use strict'
const {promisify} = require('util')

const dorita980 = require('dorita980')
const pTimeout = require('p-timeout')

const DEFAULT_TIMEOUT = 3000

const COMMANDS = {
    CLEAN_ROOM: 'cleanRoom',
    DOCK: 'dock',
    FIND: 'find',
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

const ROOM_ARG_KEYS = [
    'pmap_id',
    'regions'
]

const isValidCommand = function(command) {
    return Object.values(COMMANDS).includes(command)
}

const isValidRoomArg = function(args) {
    if (!args || typeof(args) !== 'object') return false
    for (const key of ROOM_ARG_KEYS) {
        if (!args.hasOwnProperty(key)) return false
    }
    return true
}

const timedPromise = function (promise, timeout = DEFAULT_TIMEOUT) {
    return pTimeout(promise, timeout)
}

class RoombaConnect {
    constructor(log, {blid, ip, robotpwd}) {
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
            this.log.debug('No IP specified, attempting IP lookup...')
            try {
                ip = await timedPromise(
                    promisify(dorita980.getRobotIP)()
                )
            } catch (error) {
                this.log.debug(`Failed to look up roomba IP: ${error}`)
            }
            this.log.info(`Found roomba at IP address: ${ip}`)
        }
        const roomba = new dorita980.Local(blid, robotpwd, ip)
        roomba.on('connect', () => {
            this.connected = true
            this.log.info('connected!')
        })
        roomba.on('close', () => {
            this.connected = false
            this.log.info('disconnected!')
        })
        return roomba
    }

    async init() {
        let state
        try {
            const roomba = await this.getRoomba()
            this.roomba = roomba
            this.log.info(`Syncing initial state for Roomba blid ${this.blid}...`)
            state = await timedPromise(
                roomba.getRobotState([...FIELDS_INIT, ...FIELDS_STATUS])
            )
        } catch (error) {
            this.log.error(`Error initializing Roomba with blid ${this.blid}: ${error}`)
            return null
        }
        if (!state) {
            this.log.warn('Falsy initial state received, returning null...')
            return null
        }
        return state
    }

    isConnected() {
        if (!this.connected) {
            this.log.info(`Roomba with blid ${this.blid} not connected, try again later.`)
            return false
        }
        return true
    }

    async sync() {
        const {blid, roomba} = this
        if (!this.isConnected()) {
            return null
        }
        this.log.info(`Syncing state for Roomba blid ${blid}...`)
        let state
        try {
            state = await timedPromise(
                roomba.getRobotState(FIELDS_STATUS)
            )
        } catch (error) {
            this.log.error(`Error syncing Roomba state with blid ${blid}: ${error}`)
            return null
        }
        if (!state) {
            this.log.warn(`Falsy state received for Roomba with blid ${blid}, returning null...`)
            return null
        }
        return state
    }

    async sendCommand(command, roomArgs) {
        if (!isValidCommand(command)) {
            throw new Error(`Invalid command: ${command}`)
        }
        if (roomArgs && command !== COMMANDS.CLEAN_ROOM) {
            throw new Error(`Arguments not allowed for command: ${command}`)
        }
        if (command === COMMANDS.CLEAN_ROOM && !isValidRoomArg(roomArgs)) {
            throw new Error(`Missing required argument for command: ${command}`)
        }
        if (!this.isConnected) {
            return false
        }
        const {blid, roomba} = this
        this.log.info(`Sending ${command} command to Roomba with blid ${blid}`)
        try {
            await timedPromise(roomba[command](roomArgs))
        } catch (error) {
            this.log.error(`Error sending command to Roomba with blid ${blid}: ${error}`)
            return false
        }
        this.log.debug(`Success sending ${command} command to Roomba with blid ${blid}`)
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
