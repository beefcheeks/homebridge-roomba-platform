'use strict'
const RoombaConnect = require('./roomba-connect.js')

const LOW_BATTERY_PCT = 20

const {
    PAUSE,
    RESUME,
    START,
    STOP
} = RoombaConnect.COMMANDS

const CHARGING = 'charge'
const PAUSED = 'pause'
const RUNNING = 'run'
const STOPPED = 'stop'

class RoombaDevice {

    constructor(platform, config) {
        const {blid, robotpwd, ip} = config
        if (!blid) {
            throw new Error('No blid provided!')
        }
        if (!robotpwd) {
            throw new Error('No password provided!')
        }
        this.platform = platform
        this.config = config
        this.connect = new RoombaConnect(platform.log, {blid, robotpwd, ip})
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

    get id() {
        return this.config.blid
    }

    setStateDetails({batPct, bin, cleanMissionStatus, name, lastCommand}) {
        this.batteryLevel = batPct
        this.binStatus = bin.full
        this.name = name
        this.lastCommand = lastCommand.command
        this.phase = cleanMissionStatus.phase
    }

    setStartSwitchService(service) {
        const platform = this.platform
        const device = this

        this.switchService = service
        this.switchService.getCharacteristic(platform.Characteristic.On)
            .onGet(async () => {
                platform.log('Running switch state requested')
                return device.getRunningStatus()
            })
            .onSet(async (value) => {
                platform.log('Running switch state changed')
                try {
                    await device.setRunState(value)
                } catch (error) {
                    platform.log(`Error changing running switch state: ${error}`)
                }
            })
    }

    setPauseSwitchService(service) {
        const platform = this.platform
        const device = this

        this.switchService = service
        this.switchService.getCharacteristic(platform.Characteristic.On)
            .onGet(async () => {
                platform.log('Paused switch state requested')
                return device.getPausedStatus()
            })
            .onSet(async (value) => {
                platform.log('Paused switch state changed')
                try {
                    await device.setPausedState(value)
                } catch (error) {
                    platform.log(`Error changing paused switch state: ${error}`)
                }
            })
    }

    setRoomSwitchService(service) {
        const platform = this.platform
        const device = this

        this.switchService = service
        this.switchService.getCharacteristic(platform.Characteristic.On)
            .onGet(async () => {
                platform.log('Paused switch state requested')
                return device.getPausedStatus()
            })
            .onSet(async (value) => {
                platform.log('Paused switch state changed')
                try {
                    await device.setPausedState(value)
                } catch (error) {
                    platform.log(`Error changing paused switch state: ${error}`)
                }
            })
    }

    setBinService(service) {
        const platform = this.platform
        const device = this

        this.batteryService = service
        this.batteryService.getCharacteristic(platform.Characteristic.OccupancyDetected)
            .onGet(async () => {
                platform.log('Bin status requested')
                return device.getBinFull()
            })
    }

    setBatteryService(service) {
        const platform = this.platform
        const device = this

        this.batteryService = service
        this.batteryService.getCharacteristic(platform.Characteristic.BatteryLevel)
            .onGet(async () => {
                platform.log('Battery level requested')
                return device.getBatteryLevel()
            })
        this.batteryService.getCharacteristic(platform.Characteristic.StatusLowBattery)
            .onGet(async () => {
                platform.log('Battery level requested')
                return device.getBatteryLevel() <= LOW_BATTERY_PCT
            })
        this.batteryService.getCharacteristic(platform.Characteristic.ChargingState)
            .onGet(async () => {
                platform.log('Battery level requested')
                return device.getChargingStatus()
            })
    }

    setDockService(service) {
        const platform = this.platform
        const device = this

        this.batteryService = service
        this.batteryService.getCharacteristic(platform.Characteristic.ContactSensorState)
            .onGet(async () => {
                platform.log('Bin status requested')
                return device.getDockedStatus()
            })
    }

    async sync() {
        const device = this
        const state = await device.connect.sync()
        device.setStateDetails(state)
    }

    getBatteryLevel() {
        let value = this.batteryLevel
        this.platform.log.debug('getBatteryLevel: ' + value)
        return value
    }

    getBinFull() {
        let value = this.binStatus
        this.platform.log.debug('getBinFull: ' + value)
        return value
    }

    getChargingStatus() {
        let value = this.phase === CHARGING
        this.platform.log.debug('getChargingStatus: ' + value)
        return value
    }

    getDockedStatus() {
        let value = this.phase !== CHARGING
        this.platform.log.debug('getDockedStatus: ' + value)
        return value
    }

    getPausedStatus() {
        let value = this.lastCommand === PAUSED && this.phase === STOPPED
        this.platform.log.debug('getPausedStatus: ' + value)
        return value
    }

    getRunningStatus() {
        let value = this.phase === RUNNING
        this.platform.log.debug('getRunningStatus: ' + value)
        return value
    }

    async sendCommand(command) {
        return await this.connect.sendCommand(command)
    }

    async setPauseState(value) {
        let command = value ? PAUSE : RESUME
        return await this.sendCommand(command)
    }

    async setRunState(value) {
        let command = value ? START : STOP
        return await this.sendCommand(command)
    }

    shutdown() {
        this.connect.disconnect()
    }
}

module.exports = RoombaDevice
