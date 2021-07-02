'use strict'

const platform = require('./lib/roomba-platform.js')

module.exports = (homebridge) => {
    homebridge.registerPlatform(
        platform.PLUGIN_NAME,
        platform.PLATFORM_NAME,
        platform.RoombaPlatform,
        true
    )
}
