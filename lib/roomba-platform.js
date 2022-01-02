'use strict'

const RoombaDevice = require('./roomba-device.js')

const PLUGIN_NAME = 'homebridge-roomba-platform'
const PLATFORM_NAME = 'RoombaPlatform'

const DEFAULT_POLLING_INTERVAL = 5000

class RoombaPlatform {
    constructor(log, config, api) {
        if (!config) {
            log.warn('Config not provided, please update your settings.')
            return
        }

        if (!api) {
            log.warn(
                'Homebridge API not available, please update or check your settings.'
            )
            return
        }
        this.Accessory = api.platformAccessory
        this.Service = api.hap.Service
        this.Characteristic = api.hap.Characteristic
        this.UUIDGen = api.hap.uuid

        this.log = log
        this.config = config
        this.api = api
        this.accessories = []
        this.devices = []

        api.on('didFinishLaunching', () => {
            log.info('Finished launching')
            ;(async () => {
                for (const deviceConfig of config.devices) {
                    let roombaDevice
                    try {
                        roombaDevice = new RoombaDevice(deviceConfig, this.log, this.Characteristic)
                    } catch (e) {
                        log.error('Error initializing Roomba device: ' + e.message)
                        return
                    }
                    try {
                        await roombaDevice.init()
                    } catch (e) {
                        log.error('Error syncing initial Roomba state: ' + e.message)
                        this.accessories.forEach(accessory => {
                            this.removeAccessory(accessory)
                        })
                        return
                    }
                    this.devices.push(roombaDevice)
                }
                await this.configure()
                this.pollingInterval = this.config.pollingFrequency || DEFAULT_POLLING_INTERVAL
                setTimeout(this.poll.bind(this), this.pollingInterval)
            })()
        })

        api.on('shutdown', () => {
            log('Shutdown')
        })
    }

    /**
     * Called when cached accessories are restored
     */
    configureAccessory(accessory) {
        this.log(`Configure Accessory: ${accessory.displayName} ${accessory.UUID}`)
        accessory.reachable = true
        this.accessories.push(accessory)
    }

    async configure() {
        this.devices.forEach(async (device) => {
            const {
                hideBatteryAccessory,
                hideBinAccessory,
                hideDockAccessory,
                hideMotionAccessory,
                hidePauseAccessory,
                hideReturnAccessory,
                hideStartAccessory,
                maps
            } = device.config
            let accessories = []
            if (!hideBatteryAccessory) {
                let batteryAccessory = this.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Battery'
                    )
                })
                if (!batteryAccessory) {
                    batteryAccessory = this.addAccessory(device, 'Battery')
                    accessories.push(batteryAccessory)
                }
            }
            if (!hideBinAccessory) {
                let binAccessory = this.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Bin'
                    )
                })
                if (!binAccessory) {
                    binAccessory = this.addAccessory(device, 'Bin')
                    accessories.push(binAccessory)
                }
            }
            if (!hideDockAccessory) {
                let dockAccessory = this.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Dock'
                    )
                })
                if (!dockAccessory) {
                    dockAccessory = this.addAccessory(device, 'Dock')
                    accessories.push(dockAccessory)
                }
            }
            if (!hideMotionAccessory) {
                let motionAccessory = this.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Motion'
                    )
                })
                if (!motionAccessory) {
                    motionAccessory = this.addAccessory(device, 'Motion')
                    accessories.push(motionAccessory)
                }
            }
            if (!hidePauseAccessory) {
                let pauseAccessory = this.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Pause'
                    )
                })
                if (!pauseAccessory) {
                    pauseAccessory = this.addAccessory(device, 'Pause')
                    accessories.push(pauseAccessory)
                }
            }
            if (!hideReturnAccessory) {
                let returnAccessory = this.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Return'
                    )
                })
                if (!returnAccessory) {
                    returnAccessory = this.addAccessory(device, 'Return')
                    accessories.push(returnAccessory)
                }
            }
            if (!hideStartAccessory) {
                let startAccessory = this.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Start'
                    )
                })
                if (!startAccessory) {
                    startAccessory = this.addAccessory(device, 'Start')
                    accessories.push(startAccessory)
                }
            }
            if (Array.isArray(maps)) {
                for (const map of maps) {
                    const {pMapId, rooms} = map
                    if (!pMapId) {
                        this.log.error(`Map missing required key ${pMapId}`)
                        break
                    }
                    if (Array.isArray(rooms)) {
                        for (const {name, regionIds} of rooms) {
                            if (!name) {
                                this.log.error(`Room missing required key name for map ${pMapId}`)
                            }
                            if (!Array.isArray(regionIds) || regionIds.length < 1) {
                                this.log.error(`Room missing required Array regionIds for map ${pMapId}`)
                            }
                            let roomAccessory = this.accessories.find((accessory) => {
                                return (
                                    accessory.context.deviceId === device.id &&
                                    accessory.context.name === name &&
                                    accessory.context.type == 'Room' &&
                                    accessory.context.options.pMapId === pMapId
                                )
                            })
                            if (!roomAccessory) {
                                roomAccessory = this.addAccessory(device, 'Room', name, {pMapId, regionIds})
                                accessories.push(roomAccessory)
                            }
                        }
                    }
                }
            }

            this.api.registerPlatformAccessories(
                PLUGIN_NAME,
                PLATFORM_NAME,
                accessories
            )
            this.accessories.forEach(async (accessory) => {
                await this.configureAccessoryServices(accessory, device)
            })
        })

        this.accessories.forEach((accessory) => {
            let existingDevice = this.devices.find((device) => {
                let uuid = this.UUIDGen.generate(device.id)
                return (
                    accessory.context.deviceId === device.id ||
                    accessory.UUID === uuid
                )
            })

            if (!existingDevice) {
                this.removeAccessory(accessory)
            }
        })
    }

    addAccessory(device, type, name, options) {
        const uuid = this.UUIDGen.generate(device.id + type + name)
        this.log(`Add Accessory: ${device.name} ${type} ${name} ${uuid}`)
        let accessoryName = `${device.name} ${type}`
        if (name) accessoryName = `${device.name} ${name}`
        const accessory = new this.Accessory(accessoryName, uuid)

        accessory.context.deviceId = device.id
        accessory.context.type = type
        if (name) accessory.context.name = name
        if (options) accessory.context.options = options

        this.accessories.push(accessory)
        return accessory
    }

    async configureAccessoryServices(accessory, device) {
        this.log(
            `Configuring ${accessory.context.type} Services: ${device.name} ${device.id}`
        )

        accessory
            .getService(this.Service.AccessoryInformation)
            .setCharacteristic(
                this.Characteristic.Manufacturer,
                'iRobot'
            )
            .setCharacteristic(
                this.Characteristic.Model,
                device.model
            )
            .setCharacteristic(
                this.Characteristic.SerialNumber,
                device.serial
            )
            .setCharacteristic(this.Characteristic.HardwareRevision, '3.0')
            .setCharacteristic(this.Characteristic.FirmwareRevision, '3.0')

        switch (accessory.context.type) {
            case 'Battery':
                await this.configureBatteryAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Bin':
                await this.configureBinAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Dock':
                await this.configureDockAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Motion':
                await this.configureMotionAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Pause':
                await this.configurePauseAccessoryServices(
                    accessory,
                    device
                )
                break
                case 'Return':
                    await this.configureReturnAccessoryServices(
                        accessory,
                        device
                    )
                    break
            case 'Room':
                await this.configureRoomAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Start':
                await this.configureStartAccessoryServices(
                    accessory,
                    device
                )
                break
        }
    }

   async configureBatteryAccessoryServices(accessory, device) {
        let batteryService = accessory.getService(this.Service.BatteryService)
        if (!batteryService) {
            batteryService = accessory.addService(
                this.Service.BatteryService,
                accessory.displayName
            )
        }
        device.setBatteryService(batteryService)
    }

    async configureBinAccessoryServices(accessory, device) {
        let binService = accessory.getService(this.Service.OccupancySensor)
        if (!binService) {
            binService = accessory.addService(
                this.Service.OccupancySensor,
                accessory.displayName
            )
        }
        device.setBinService(binService)
    }

    async configureDockAccessoryServices(accessory, device) {
        let dockService = accessory.getService(this.Service.ContactSensor)
        if (!dockService) {
            dockService = accessory.addService(
                this.Service.ContactSensor,
                accessory.displayName
            )
        }
        device.setDockService(dockService)
    }

    async configureMotionAccessoryServices(accessory, device) {
        let motionService = accessory.getService(this.Service.MotionSensor)
        if (!motionService) {
            motionService = accessory.addService(
                this.Service.MotionSensor,
                accessory.displayName
            )
        }
        device.setMotionService(motionService)
    }

    async configurePauseAccessoryServices(accessory, device) {
        let pauseService = accessory.getService(
            this.Service.Switch,
            'Pause'
        )
        if (!pauseService) {
            pauseService = accessory.addService(
                this.Service.Switch,
                accessory.displayName,
                'Pause'
            )
        }
        device.setPauseSwitchService(pauseService)
    }

    async configureReturnAccessoryServices(accessory, device) {
        let returnService = accessory.getService(
            this.Service.Switch,
            'Return'
        )
        if (!returnService) {
            returnService = accessory.addService(
                this.Service.Switch,
                accessory.displayName,
                'Return'
            )
        }
        device.setReturnSwitchService(returnService)
    }

    async configureRoomAccessoryServices(accessory, device) {
        const {name, options} = accessory.context
        let roomService = accessory.getServiceByUUIDAndSubType(
            this.Service.Switch,
            name
        )
        if (!roomService) {
            roomService = accessory.addService(
                this.Service.Switch,
                accessory.displayName,
                name
            )
        }
        device.setRoomSwitchService(roomService, name, options)
    }

    async configureStartAccessoryServices(accessory, device) {
        let startService = accessory.getServiceByUUIDAndSubType(
            this.Service.Switch,
            'Start'
        )
        if (!startService) {
            startService = accessory.addService(
                this.Service.Switch,
                accessory.displayName,
                'Start'
            )
        }
        device.setStartSwitchService(startService)
    }

    async poll() {
        await asyncForEach(this.devices, async (device) => {
            try {
                await device.sync()
            } catch (error) {
                this.log.warn(`Error syncing Roomba Status for ${device.id}: ${error.message}`)
            }
        })
        setTimeout(this.poll.bind(this), this.pollingInterval)
    }

    removeAccessory(accessory) {
        let uuid = accessory.UUID

        this.log(
            'Remove Accessory: ' + accessory.displayName + ' ' + accessory.UUID
        )

        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
            accessory,
        ])
        this.accessories = this.accessories.filter((accessory) => {
            return accessory.UUID !== uuid
        })
    }
}

async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array)
    }
}

module.exports = {
    RoombaPlatform,
    PLUGIN_NAME,
    PLATFORM_NAME,
}
