'use strict'
const RoombaConnect = require('./roomba-connect.js')

const LOW_BATTERY_PCT = 20

const {
    CLEAN_ROOM,
    DOCK,
    PAUSE,
    RESUME,
    START,
    STOP
} = RoombaConnect.COMMANDS

// Phases
const CHARGING = 'charge'
const EVACUATING = 'evac'
const RETURNING = 'hmUsrDock'
const RUNNING = 'run'
const STOPPED = 'stop'

class RoombaDevice {

    constructor(config, log, Characteristic) {
        this.config = config
        this.log = log
        this.Characteristic = Characteristic
        try {
            this.connect = new RoombaConnect(log, {blid, robotpwd, ip})
        } catch (error) {
            this.log.error(`Error initializing RoombaConnect: ${error.message}`)
        }
    }

    async init() {
        const {
            batPct,
            bin,
            cleanMissionStatus,
            hwPartsRev,
            lastCommand,
            name,
            sku
        } = await this.connect.init()
        this.serial = hwPartsRev.navSerialNo
        this.model = sku
        this.setStateDetails({batPct, bin, cleanMissionStatus, lastCommand, name})
    }

    async sendCommand(command, roomArgs) {
        return await this.connect.sendCommand(command, roomArgs)
    }

    async sync() {
        const state = await this.connect.sync()
        this.setStateDetails(state)
    }

    get config() {
        return this.config
    }

    get id() {
        return this.config.blid
    }

    shutdown() {
        this.connect.disconnect()
    }

    setStateDetails({batPct, bin, cleanMissionStatus, name, lastCommand}) {
        const {command, pmap_id, regions} = lastCommand
        this.batteryLevel = batPct
        this.binStatus = bin.full
        this.name = name
        this.lastCommand = command
        this.pMapId = pmap_id
        this.phase = cleanMissionStatus.phase
        // If regions exist, format it for easy comparison
        if (Array.isArray(regions)) {
            this.regions = regions.map(({region_id}) => {return region_id})
        }
    }

    getBatteryLevel() {
        const value = this.batteryLevel
        this.log.debug(`getBatteryLevel: ${value}`)
        return value
    }

    getBinFull() {
        const value = this.binStatus
        this.log.debug(`getBinFull: ${value}`)
        return value
    }

    getChargingStatus() {
        const value = this.phase === CHARGING
        this.log.debug(`getChargingStatus: ${value}`)
        return value
    }

    getDockedStatus() {
        const value = (this.phase !== CHARGING && this.phase !== EVACUATING)
        this.log.debug(`getDockedStatus: ${value}`)
        return value
    }

    getMotionStatus() {
        const value = (this.phase !== CHARGING && this.phase !== STOPPED)
        this.log.debug(`getMotionStatus: ${value}`)
        return value
    }

    getPausedStatus() {
        const value = (this.lastCommand === PAUSE && this.phase === STOPPED)
        this.log.debug(`getPausedStatus: ${value}`)
        return value
    }

    getReturningStatus() {
        const value = this.phase === RETURNING
        this.log.debug(`getReturningStatus: ${value}`)
        return value
    }

    getRoomStatus(name, {pMapId, regions}) {
        const value = (
            this.phase === RUNNING
            && this.pMapId === pMapId
            && this.regions.length === regions.length
            && this.regions.every((regionId) => regions.indexOf(regionId) >= 0)
        )
        this.log.debug(`getRoomStatus ${name}: ${value}`)
        return value
    }

    getStartedStatus() {
        let value = (this.phase === RUNNING && !this.regions)
        this.log.debug('getStartedStatus: ' + value)
        return value
    }

    setBatteryService(service) {
        this.batteryService = service
        this.batteryService.getCharacteristic(this.Characteristic.BatteryLevel)
            .onGet(async () => {
                this.log('Battery level requested')
                return this.getBatteryLevel()
            })
        this.batteryService.getCharacteristic(this.Characteristic.StatusLowBattery)
            .onGet(async () => {
                this.log('Battery level requested')
                return this.getBatteryLevel() <= LOW_BATTERY_PCT
            })
        this.batteryService.getCharacteristic(this.Characteristic.ChargingState)
            .onGet(async () => {
                this.log('Battery level requested')
                return this.getChargingStatus()
            })
    }

    setBinService(service) {
        this.binService = service
        this.binService.getCharacteristic(this.Characteristic.OccupancyDetected)
            .onGet(async () => {
                this.log('Bin status requested')
                return this.getBinFull()
            })
    }

    setDockService(service) {
        this.dockService = service
        this.dockService.getCharacteristic(this.Characteristic.ContactSensorState)
            .onGet(async () => {
                this.log('Dock status requested')
                return this.getDockedStatus()
            })
    }

    setMotionService(service) {
        this.motionService = service
        this.motionService.getCharacteristic(this.Characteristic.MotionDetected)
            .onGet(async () => {
                this.log('Motion status requested')
                return this.getMotionStatus()
            })
    }

    setPauseSwitchService(service) {
        this.pauseSwitchService = service
        this.pauseSwitchService.getCharacteristic(this.Characteristic.On)
            .onGet(async () => {
                this.log('Pause switch state requested')
                return this.getPausedStatus()
            })
            .onSet(async (value) => {
                this.log('Pause switch state changed')
                try {
                    await this.setRunState(value)
                } catch (error) {
                    this.log.error(`Error changing pause switch state: ${error}`)
                }
            })
    }

    setReturnSwitchService(service) {
        this.returnSwitchService = service
        this.returnSwitchService.getCharacteristic(this.Characteristic.On)
            .onGet(async () => {
                this.log('Return switch state requested')
                return this.getReturningStatus()
            })
            .onSet(async (value) => {
                this.log('Return switch state changed')
                try {
                    await this.setReturnState(value)
                } catch (error) {
                    this.log.error(`Error changing return switch state: ${error}`)
                }
            })
    }

    setRoomSwitchService(service, name, options) {
        // Format payload in advance for sending clean room command
        const regions = new Array()
        const {pMapId, regionIds} = options
        regionIds.forEach((regionId) => {
            regions.push({region_id: regionId.toString(), type: 'rid'})
        })
        // Set up event listeners
        this.roomSwitchService = service
        this.roomSwitchService.getCharacteristic(this.Characteristic.On)
            .onGet(async () => {
                this.log(`${name} switch state requested`)
                return this.getRoomStatus(name, options)
            })
            .onSet(async () => {
                this.log(`${name} switch state changed`)
                try {
                    await this.setRoomStatus(name, options, {pmap_id: pMapId, regions})
                } catch (error) {
                    this.log(`Error changing ${name} switch state: ${error}`)
                }
            })
    }

    setStartSwitchService(service) {
        this.startSwitchService = service
        this.startSwitchService.getCharacteristic(this.Characteristic.On)
            .onGet(async () => {
                this.log('Start switch state requested')
                return this.getStartedStatus()
            })
            .onSet(async (value) => {
                this.log('Start switch state changed')
                try {
                    await this.setRunState(value)
                } catch (error) {
                    this.log(`Error changing start switch state: ${error}`)
                }
            })
    }

    async setReturnState() {
        if (this.phase === CHARGING || this.phase === EVACUATING) {
            this.log.warn('Roomba already docked, ignoring command...')
            return
        }
        // Roomba must first be paused or stopped before it is docked
        if (this.phase !== STOPPED) {
            await this.sendCommand(STOP)
            // Even after it is paused/stopped it takes a few seconds before it accepts a dock command. No idea why.
            return setTimeout(this.setReturnState.bind(this), 3000)
        }
        return await this.sendCommand(DOCK)
    }

    async setRoomStatus(name, options, roomArgs) {
        if (this.getRoomStatus(name, options)) {
            return await this.sendCommand(PAUSE)
        }
        return await this.sendCommand(CLEAN_ROOM, roomArgs)
    }

    async setRunState() {
        let command
        switch (this.phase) {
            case CHARGING:
                command = START
                break
            case EVACUATING:
                this.log.warn(`Cannot send command while current phase is ${EVACUATING}! Try again later.`)
                break
            case RETURNING: case RUNNING:
                command = PAUSE
                break
            case STOPPED:
                if (this.lastCommand === PAUSE) {
                    command = RESUME
                } else {
                    command = START
                }
                break
            default:
                this.log.error(`Unrecognized current phase: ${this.phase}, command not sent!`)
                return false
        }
        return await this.sendCommand(command)
    }
}

module.exports = RoombaDevice
