'use strict';

const Homey = require('homey');

class BlaubergVentoApp extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('Blauberg Vento Fan app has been initialized');
  }
}

module.exports = BlaubergVentoApp;
