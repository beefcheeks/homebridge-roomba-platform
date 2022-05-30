'use strict'
const RoombaConnect = require('./roomba-connect.js')

const LOW_BATTERY_PCT = 20
// A delay is required between commands for the roomba
const TIME_BETWEEN_COMMANDS = 3000

const {
    CLEAN_ROOM,
    DOCK,
    FIND,
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
const STUCK = 'stuck'

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

    setStateDetails({batPct, bin, cleanMissionStatus, lastCommand}) {
        this.log.debug(`Setting state: ${JSON.stringify({batPct, bin, cleanMissionStatus, lastCommand})}`)
        const {phase, missionId} = cleanMissionStatus
        const {command, pmap_id, regions} = lastCommand
        this.batteryLevel = batPct
        this.binStatus = bin.full
        this.lastCommand = command
        this.missionId = missionId
        this.pMapId = pmap_id
        this.phase = phase
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
        if (this.phase === RUNNING
         && this.pMapId
         && this.regionIds) {
            // Log room command data if enabled to help with initial configuration
            this.log.debug(`Last room command data - pMapId: ${this.pMapId}, regionIds: ${this.regionIds}`)
            if (this.missionId) {
                // Reset mapping to prevent unlimited size creep
                this.missionIdMap = {}
                this.missionIdMap[missionId] = {pMapId, regionIds}
            }
        }
        this.updateServiceState()
    }

    updateServiceState() {
        this.updateBattery(this.getBatteryLevel())
        this.updateControls(this.getCurrentControlStatus())
        this.updateDockSensor(this.getDockedStatus())
        this.updateFindSwitch(this.getFindStatus())
        this.updateMotionSensor(this.getMotionStatus())
        this.updatePauseSwitch(this.getPausedStatus())
        this.updateReturnSwitch(this.getReturningStatus())
        this.updateStartSwitch(this.getStartedStatus())
        this.updateStuckSensor(this.getStuckStatus())
        if (this.roomSwitchServices) {
            Object.keys(this.roomSwitchServices).forEach(roomName => {
                const roomStatus = this.getRoomStatus(roomName, this.roomSwitchConfig[roomName])
                this.updateRoomSwitch(roomName, roomStatus)
            })
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

    getCurrentControlStatus() {
        let value
        switch (this.phase) {
            case CHARGING: case STOPPED:
                if (this.lastCommand === PAUSE) {
                    value =  this.Characteristic.CurrentMediaState.PAUSE
                } else {
                    value =  this.Characteristic.CurrentMediaState.STOP
                }
                break
            case EVACUATING: case value = RETURNING:
                value =  this.Characteristic.CurrentMediaState.LOADING
                break
            case RUNNING:
                value =  this.Characteristic.CurrentMediaState.PLAY
                break
            case STUCK:
                value =  this.Characteristic.CurrentMediaState.INTERRUPTED
                break
            default:
                this.log.error(`Unrecognized current phase: ${this.phase}, defaulting to ${this.phase}`)
                value =  this.Characteristic.CurrentMediaState.STOP
                break
            }
        this.log.debug(`getCurrentControlStatus: ${value}`)
        return value
    }

    getDockedStatus() {
        const value = (
            this.phase !== CHARGING
         && this.phase !== EVACUATING
        )
        this.log.debug(`getDockedStatus: ${value}`)
        return value
    }

    getFindStatus() {
        const value = (
            this.lastCommand === FIND
         && this.phase !== RUNNING
         && this.phase !== EVACUATING
        )
        this.log.debug(`getFindStatus: ${value}`)
        return value
    }

    getMissionDetails() {
        if (this.missionId
            && this.missionIdMap
            && this.missionIdMap[this.missionId]
           ) {
            return this.missionIdMap[this.missionId]
        }
        return {pMapId: null, regionIds: null}
    }

    getLowBattery() {
        const value = this.getBatteryLevel() <= LOW_BATTERY_PCT
        this.log.debug(`getLowBattery: ${value}`)
        return value
    }

    getMotionStatus() {
        const value = (
            this.phase === RETURNING
         || this.phase === RUNNING
        )
        this.log.debug(`getMotionStatus: ${value}`)
        return value
    }

    getPausedStatus() {
        const value = (
            this.phase === STUCK
         || this.lastCommand === PAUSE
         && this.phase === STOPPED
        )
        this.log.debug(`getPausedStatus: ${value}`)
        return value
    }

    getReturningStatus() {
        const value = this.phase === RETURNING
        this.log.debug(`getReturningStatus: ${value}`)
        return value
    }

    getRoomStatus(name, {roomPMapId, roomRegionIds}) {
        let value = false
        if (this.phase === RUNNING) {
            let currentPMapId = this.pMapId
            let currentRegionIds = this.regionIds
            if (!currentPMapId || !currentRegionIds) {
                const {pMapId, regionIds} = this.getMissionDetails()
                currentPMapId = pMapId
                currentRegionIds = regionIds
            }
            value = (
                currentPMapId === roomPMapId
             && currentRegionIds
             && currentRegionIds.length === roomRegionIds.length
             && currentRegionIds.every((regionId) => roomRegionIds.indexOf(regionId) >= 0)
            )
        }
        this.log.debug(`getRoomStatus ${name}: ${value}`)
        return value
    }

    getStartedStatus() {
        const value = (
            this.phase === RUNNING
         && !this.regionIds
        )
        this.log.debug('getStartedStatus: ' + value)
        return value
    }

    getStuckStatus() {
        const value = this.phase === STUCK
        this.log.debug(`getStuckStatus: ${value}`)
        return value
    }

    getTargetControlState() {
        return this.targetControlState || this.getCurrentControlStatus()
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
                return this.getLowBattery()
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

    setFindSwitchService(service) {
        this.findSwitchService = service
        this.findSwitchService.getCharacteristic(this.Characteristic.On)
            .onGet(async () => {
                this.log('Find switch state requested')
                return this.getFindStatus()
            })
            .onSet(async (value) => {
                this.log('Find switch state changed')
                let success
                try {
                    success = await this.setFindState()
                } catch (error) {
                    this.log(`Error changing Find switch state: ${error}`)
                }
                if (success) {
                    if (value) {
                        this.lastCommand = FIND
                        this.updateServiceState()
                    }
                } else {
                    // If update fails, set find switch state back
                    this.updateFindSwitch(!value)
                }
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
                    success = await this.setRunState()
                } catch (error) {
                    this.log.error(`Error changing pause switch state: ${error}`)
                }
                // Update all relevant switches based on successful state change
                if (success) {
                    if (value) {
                        // Save last state when pausing for fast resume
                        if (this.getReturningStatus()) {
                            this.wasReturning = true
                        }
                        this.phase = STOPPED
                        this.lastCommand = PAUSE
                    } else {
                        // Turn on correct switch based on last saved state
                        if (this.wasReturning) {
                            this.phase = RETURNING
                        } else {
                            this.phase = RUNNING
                            const {pMapId, regionIds} =  this.getMissionDetails()
                            this.pMapId = pMapId
                            this.regionIds = regionIds
                        }
                    }
                    this.updateServiceState()
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
                    if (value) {
                        this.phase = RETURNING
                        // Clear previous state if return switch turned on
                        this.clearLastState()
                    } else {
                        // If switching off, set wasReturning true for fast resume command
                        this.wasReturning = true
                        this.phase = STOPPED
                        this.lastCommand = PAUSE
                    }
                    this.updateServiceState()
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
        // Initialize room config mapping
        if (!this.roomSwitchConfig) {
            this.roomSwitchConfig = {}
        }
        // Save config mapping to class-level object
        this.roomSwitchConfig[name] = options
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
                    if (value) {
                        this.phase = RUNNING
                        this.pMapId = pMapId
                        this.regionIds = regionIds
                        this.missionId = null
                        this.clearLastState()
                    } else {
                        this.phase = STOPPED
                        this.lastCommand = PAUSE
                    }
                    this.updateServiceState()
                } else {
                    this.updateRoomSwitch(name, !value)
                }
            })
    }

    async setTargetControlState(value) {
        switch(value) {
            case this.Characteristic.TargetMediaState.PLAY:
                this.targetControlState = this.Characteristic.TargetMediaState.PLAY
                if (this.lastCommand === PAUSE) {
                    return await this.sendCommand(RESUME)
                }
                return await this.sendCommand(START)
            case this.Characteristic.TargetMediaState.PAUSE:
                this.targetControlState = this.Characteristic.TargetMediaState.PAUSE
                return await this.sendCommand(PAUSE)
            case this.Characteristic.TargetMediaState.STOP:
                this.targetControlState = this.Characteristic.TargetMediaState.STOP
                return await this.sendCommand(STOP)
            default:
                this.log.error(`Unrecognized control state value: ${value}. No action taken.`)
                return false
        }
    }

    setControlsService(service) {
        this.controlsService = service
        this.controlsService.getCharacteristic(this.Characteristic.CurrentMediaState)
            .onGet(async () => {
                this.log('Control current state requested')
                return this.getCurrentControlStatus()
            })
        this.controlsService.getCharacteristic(this.Characteristic.TargetMediaState)
            .onGet(async () => {
                this.log('Control target state requested')
                return this.getTargetControlState()
            })
            .onSet(async (value) => {
                this.log(`Set control state to ${value} requested`)
                let success
                try {
                    success = await this.setTargetControlState(value)
                } catch (error) {
                    this.log(`Error setting controls state: ${error}`)
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
                    success = await this.setRunState()
                } catch (error) {
                    this.log(`Error changing start switch state: ${error}`)
                }
                if (success) {
                    // If success, assume state change prior to poll
                    if (value) {
                        this.phase = RUNNING
                        this.pmap_id = null
                        this.regionIds = null
                        this.missionId = null
                        this.clearLastState()
                    } else {
                        this.phase = STOPPED
                    }
                    this.updateServiceState()
                } else {
                    this.updateStartSwitch(!value)
                }
            })
    }

    setStuckService(service) {
        this.stuckService = service
        this.stuckService.getCharacteristic(this.Characteristic.SmokeDetected)
            .onGet(async () => {
                this.log('Stuck status requested')
                return this.getStuckStatus()
            })
    }

    async setFindState() {
        if (this.phase === EVACUATING) {
            this.log.warn('Cannot set find mode while evacuating to bin!')
            return false
        }
        // Pause device first if attempting to locate
        if (this.phase === RUNNING || this.phase === RETURNING) {
            const success = await this.sendCommand(PAUSE)
            // Once paused, find command can run in a few seconds
            if (success) {
                setTimeout(this.sendCommand.bind(this, FIND), TIME_BETWEEN_COMMANDS)
            }
            // Return success if first pause command worked, even if return doesn't later
            return success
        }
        // Ensure find is stateful
        if (this.lastCommand === FIND) {
            // Sending find while ringing cancels find
            const success = await this.sendCommand(FIND)
            // No way to know whether ringing or not, so update with noop pause
            if (success) {
                setTimeout(this.sendCommand(this, PAUSE), TIME_BETWEEN_COMMANDS)
            }
            // Return success if first pause/stop command worked, even if return doesn't later
            return success
        }
        return await this.sendCommand(FIND)
    }

    async setReturnState() {
        if (this.phase === CHARGING || this.phase === EVACUATING) {
            this.log.warn('Roomba already docked, ignoring command...')
            return false
        }
        if (this.phase === RETURNING) {
            this.log.warn('Roomba already returning to dock, ignoring command...')
            return true
        }
        // Roomba must first be paused, stopped, or stuck before it is docked
        if (this.phase !== STOPPED && this.phase !== STUCK) {
            const success = await this.sendCommand(PAUSE)
            if (success) {
                // Set phase to pause and re-update service state
                this.phase = STOPPED
                this.lastCommand = PAUSE
                this.updateServiceState()
                // Even after it is paused/stopped it takes a few seconds before it accepts a dock command. No idea why.
                setTimeout(this.sendCommand(this, DOCK), TIME_BETWEEN_COMMANDS)
            }
            // Return success if first pause/stop command worked, even if return doesn't later
            return success
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
                this.log.warn(`Cannot send run command while current phase is ${EVACUATING}!`)
                return false
            case RETURNING: case RUNNING:
                command = PAUSE
                break
            case STOPPED: case STUCK:
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

    updateBattery(value) {
        if (this.batteryService) {
            this.batteryService.updateCharacteristic(
                this.Characteristic.BatteryLevel,
                value
            )
            this.batteryService.updateCharacteristic(
                this.Characteristic.StatusLowBattery,
                this.getLowBattery()
            )
            this.batteryService.updateCharacteristic(
                this.Characteristic.ChargingState,
                this.getChargingStatus()
            )
        }
    }

    updateControls(value) {
        if (this.controlsService) {
            this.controlsService.updateCharacteristic(
                this.Characteristic.CurrentMediaState,
                value
            )
        }
    }

    updateDockSensor(value) {
        if (this.dockService) {
            this.dockService.updateCharacteristic(
                this.Characteristic.ContactSensorState,
                value
            )
        }
    }

    updateFindSwitch(value) {
        if (this.findSwitchService) {
            this.findSwitchService.updateCharacteristic(
                this.Characteristic.On,
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

    updateStartSwitch(value) {
        if (this.startSwitchService) {
            this.startSwitchService.updateCharacteristic(
                this.Characteristic.On,
                value
            )
        }
    }

    updateStuckSensor(value) {
        if (this.stuckService) {
            this.stuckService.updateCharacteristic(
                this.Characteristic.SmokeDetected,
                value
            )
        }
    }

    clearLastState() {
        this.wasReturning = false
    }
}

module.exports = RoombaDevice
