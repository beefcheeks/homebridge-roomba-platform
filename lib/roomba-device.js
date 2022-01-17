'use strict'
const RoombaConnect = require('./roomba-connect.js')

const LOG_ROOM_COMMANDS_KEY = 'logRoomCommands'
const LOW_BATTERY_PCT = 20
// A delay is required between stopping and returning the roomba
const STOP_BEFORE_RETURN_DELAY = 3000

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
        this._config = config
        this.log = log
        this.Characteristic = Characteristic
        try {
            this.connect = new RoombaConnect(log, config)
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
        // Fall back to Roomba name if no name specified in config
        this.name = this.config.name || name
        this.model = sku
        this.serial = hwPartsRev.navSerialNo
        this.setStateDetails({batPct, bin, cleanMissionStatus, lastCommand})
    }

    async sendCommand(command, roomArgs) {
        return await this.connect.sendCommand(command, roomArgs)
    }

    async sync() {
        const state = await this.connect.sync()
        this.setStateDetails(state)
    }

    get config() {
        return this._config
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
        this.lastCommand = command
        this.pMapId = pmap_id
        this.phase = cleanMissionStatus.phase
        // If regions exist, format it for easy comparison
        if (Array.isArray(regions)) {
            this.regionIds = regions.map(({region_id}) => {return region_id})
        } else {
            this.regionIds = null
        }
        // Clear last state cache if last command wasn't pause
        if (this.lastCommand !== PAUSE) {
            this.clearLastState()
        }
        // Log room command data if enabled to help with initial configuration
        if (!!this.config.logRoomCommands
            && this.phase === RUNNING
            && this.pMapId
            && this.regionIds) {
                this.log(`Last room command data - pMapId: ${this.pMapId}, regionIds: ${this.regionIds}`)
        }
    }

    getActiveRoomName() {
        if (this.roomSwitchServices) {
            for (const roomName in this.roomSwitchServices) {
                if (this.roomSwitchServices[roomName].getCharacteristic(this.Characteristic.On).value) {
                    this.log.debug(`getActiveRoomName: ${roomName}`)
                    return roomName
                }
            }
        }
        return null
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

    getRoomStatus(name, {pMapId, regionIds}) {
        const value = (
            this.phase === RUNNING
            && this.pMapId === pMapId
            && this.regionIds
            && this.regionIds.every((regionId) => regionIds.indexOf(regionId) >= 0)
        )
        this.log.debug(`getRoomStatus ${name}: ${value}`)
        return value
    }

    getStartedStatus() {
        let value = (this.phase === RUNNING && !this.regionIds)
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
                let success
                try {
                    success = await this.setRunState(value)
                } catch (error) {
                    this.log.error(`Error changing pause switch state: ${error}`)
                }
                // Update all relevant switches based on successful state change
                if (success) {
                    this.updateMotionSensor(!value)
                    if (value) {
                        // Save last state when pausing for fast resume
                        if (this.getReturningStatus()) {
                            this.wasReturning = true
                        } else if (!this.getStartedStatus()) {
                            const roomName = this.getActiveRoomName()
                            if (roomName) this.lastRoomName = roomName
                        }
                        // Set all other switches to off when pausing
                        this.updateReturnSwitch(false)
                        this.updateStartSwitch(false)
                        this.updateRoomSwitchesToOff(false)
                    } else {
                        // Turn on correct switch based on last saved state
                        if (this.wasReturning) {
                            this.updateReturnSwitch(true)
                        } else if (this.lastRoomName) {
                            this.updateRoomSwitch(this.lastRoomName, true)
                        } else {
                            this.updateStartSwitch(true)
                        }
                    }
                } else {
                    this.updatePauseSwitch(!value)
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
                let success
                try {
                    success = await this.setReturnState(value)
                } catch (error) {
                    this.log.error(`Error changing return switch state: ${error}`)
                }
                // Update all relevant switches based on successful state change
                if (success) {
                    this.updateMotionSensor(value)
                    this.updatePauseSwitch(!value)
                    if (value) {
                        // If room switch turned on, set all non-pause switches to off
                        this.updateDockSensor(this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
                        this.updateStartSwitch(false)
                        this.updateRoomSwitchesToOff()
                        // Clear previous state if return switch turned on
                        this.clearLastState()
                    } else {
                        // If switching off, set wasReturning true for fast resume command
                        this.wasReturning = true
                    }
                } else {
                    this.updateReturnSwitch(!value)
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
        // Initialize room object mapping
        if (!this.roomSwitchServices) {
            this.roomSwitchServices = {}
        }
        // Set up event listeners
        this.roomSwitchServices[name] = service
        this.roomSwitchServices[name].getCharacteristic(this.Characteristic.On)
            .onGet(async () => {
                this.log(`${name} switch state requested`)
                return this.getRoomStatus(name, options)
            })
            .onSet(async (value) => {
                this.log(`${name} switch state changed`)
                let success
                try {
                    success = await this.setRoomStatus(name, options, {pmap_id: pMapId, regions})
                } catch (error) {
                    this.log(`Error changing ${name} switch state: ${error}`)
                }
                if (success) {
                    // Update all relevant switches based on successful state change
                    this.updateMotionSensor(value)
                    this.updatePauseSwitch(!value)
                    if (value) {
                        // If room switch turned on, set all non-pause switches to off
                        this.updateDockSensor(this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
                        this.updateReturnSwitch(false)
                        this.updateStartSwitch(false)
                        // Clear previous state
                        this.clearLastState()
                    } else {
                        // If switching off, set lastRoomName for fast resume command
                        this.lastRoomName = name
                    }
                } else {
                    this.updateRoomSwitch(name, !value)
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
                let success
                try {
                    success = await this.setRunState(value)
                } catch (error) {
                    this.log(`Error changing start switch state: ${error}`)
                }
                // Update all relevant switches based on successful state change
                if (success) {
                    this.updateMotionSensor(value)
                    this.updatePauseSwitch(!value)
                    if (value) {
                        // If room switch turned on, set all non-pause switches to off
                        this.updateDockSensor(this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
                        this.updateReturnSwitch(false)
                        this.updateRoomSwitchesToOff()
                        // Clear last state cache if start switch turned on
                        this.clearLastState()
                    }
                } else {
                    this.updateStartSwitch(!value)
                }
            })
    }

    async setReturnState() {
        if (this.phase === CHARGING || this.phase === EVACUATING) {
            this.log.warn('Roomba already docked, ignoring command...')
            return false
        }
        // Roomba must first be paused or stopped before it is docked
        if (this.phase !== STOPPED) {
            await this.sendCommand(STOP)
            // Even after it is paused/stopped it takes a few seconds before it accepts a dock command. No idea why.
            return setTimeout(this.setReturnState.bind(this), STOP_BEFORE_RETURN_DELAY)
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
                if (this.getPausedStatus()) {
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

    updateDockSensor(value) {
        if (this.dockService) {
            this.dockService.updateCharacteristic(
                this.Characteristic.ContactDetected,
                value
            )
        }
    }

    updateMotionSensor(value) {
        if (this.motionService) {
            this.motionService.updateCharacteristic(
                this.Characteristic.MotionDetected,
                value
            )
        }
    }

    updatePauseSwitch(value) {
        if (this.pauseSwitchService) {
            this.pauseSwitchService.updateCharacteristic(
                this.Characteristic.On,
                value
            )
        }
    }
    updateReturnSwitch(value) {
        if (this.returnSwitchService) {
            this.returnSwitchService.updateCharacteristic(
                this.Characteristic.On,
                value
            )
        }
    }

    updateRoomSwitch(name, value) {
        if (!this.roomSwitchServices.hasOwnProperty(name)) {
            return this.log.error(`Room ${name} not found for updateRoomSwitch!`)
        }
        this.roomSwitchServices[name].updateCharacteristic(
            this.Characteristic.On,
            value
        )
    }

    updateRoomSwitchesToOff(nullifyLastRoomName = true) {
        if (this.roomSwitchServices) {
            for (const roomName in this.roomSwitchServices) {
                this.updateRoomSwitch(roomName, false)
            }
            // Nullify lastRoomName unless specified otherwise
            if (nullifyLastRoomName) this.lastRoomName = null
        }
    }

    updateStartSwitch(value) {
        if (this.startSwitchService) {
            this.startSwitchService.updateCharacteristic(
                this.Characteristic.On,
                value
            )
        }
    }

    clearLastState() {
        this.lastRoomName = null
        this.wasReturning = false
    }
}

module.exports = RoombaDevice
