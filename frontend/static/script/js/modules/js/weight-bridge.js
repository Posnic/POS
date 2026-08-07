/**
 * Weight Machine Bridge for Electron/Browser Compatibility
 * Provides safe access to Electron weight machine hardware with graceful degradation for browsers
 */

(function(window) {
    'use strict';

    // Check if running in Electron environment via preload script
    const hasElectronAPI = !!(window.electronAPI && window.electronAPI.hardware);
    const isElectron = hasElectronAPI;

    // Store last received weight
    let lastWeight = null;
    let lastWeightTimestamp = null;

    // Debug logging
    console.log('[WeightBridge] Initialization Debug:');
    console.log('  - window.electronAPI exists:', !!window.electronAPI);
    console.log('  - window.electronAPI.hardware exists:', !!(window.electronAPI && window.electronAPI.hardware));
    console.log('  - isElectron:', isElectron);
    
    /**
     * Weight Machine Bridge Object
     */
    const WeightBridge = {
        /**
         * Check if weight machine is available (Electron environment)
         */
        isAvailable: function() {
            console.log('[WeightBridge] isAvailable() called, returning:', isElectron);
            return isElectron;
        },

        /**
         * Get current weight from the weight machine
         * @returns {Promise<number|null>} Weight value or null if not available
         */
        getCurrentWeight: function() {
            return new Promise((resolve, reject) => {
                if (!isElectron) {
                    console.warn('[WeightBridge] Not running in Electron - weight machine not available');
                    resolve(null);
                    return;
                }

                if (!window.electronAPI || !window.electronAPI.hardware) {
                    console.error('[WeightBridge] ❌ electronAPI.hardware not available');
                    resolve(null);
                    return;
                }

                try {
                    console.log('[WeightBridge] getCurrentWeight called');

                    // Wait for a SETTLED reading. Taking the first frame that
                    // arrives can capture the load mid-swing, which bills the
                    // customer for the wrong quantity. If nothing settles in
                    // time, fall back to the latest reading rather than
                    // failing outright, and say it was unsettled.
                    var settled = false;
                    var latest = null;
                    var stop = null;

                    var finish = function (weight, wasStable) {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timer);
                        if (typeof stop === 'function') stop();
                        if (weight === null || weight === undefined) {
                            console.warn('[WeightBridge] no weight available');
                            resolve(null);
                            return;
                        }
                        console.log('[WeightBridge] weight', weight, 'kg stable=', wasStable);
                        lastWeight = weight;
                        lastWeightTimestamp = Date.now();
                        resolve(weight);
                    };

                    var timer = setTimeout(function () {
                        finish(latest, false);
                    }, 6000);   // scales need a moment to settle

                    stop = window.electronAPI.hardware.onUsbData(function (data) {
                        var weight = (typeof data === 'object') ? data.weight : parseFloat(data);
                        if (!isFinite(weight)) return;
                        latest = weight;
                        // `stable` comes from the scale reader; older builds
                        // without it fall back to accepting the first reading.
                        var isStable = (typeof data === 'object' && 'stable' in data) ? !!data.stable : true;
                        if (isStable && weight > 0) finish(weight, true);
                    });

                } catch (error) {
                    console.error('[WeightBridge] Error reading weight:', error);
                    reject(error);
                }
            });
        },

        /**
         * Start continuous weight monitoring
         * @param {Function} callback - Called with weight value on each update
         * @returns {Function} Stop function to end monitoring
         */
        startMonitoring: function(callback) {
            if (!isElectron) {
                console.warn('[WeightBridge] Not running in Electron - monitoring not available');
                return function() {}; // Return empty stop function
            }

            var stopListening = null;
            try {
                // Use electronAPI from preload script
                if (window.electronAPI && window.electronAPI.hardware) {
                    console.log('[WeightBridge] Starting monitoring via electronAPI');
                    
                    // Set up listener FIRST for ongoing weight updates
                    stopListening = window.electronAPI.hardware.onUsbData((data) => {
                        const weight = typeof data === 'object' ? data.weight : parseFloat(data);
                        console.log('[WeightBridge] Received weight update:', weight, 'kg');
                        callback(weight);
                    });

                    /*
                     * Seed the display with the last reading.
                     *
                     * This called getLastWeight, which is not on the bridge -
                     * the method is broadcastWeight. So it threw every time,
                     * and the seeding never happened. On a scale that only
                     * transmits when the load changes, that left the live
                     * display empty from the moment the till opened until
                     * somebody put something on the platter - which reads
                     * exactly like a scale that is not working.
                     *
                     * Delayed so the listener above is registered first,
                     * otherwise the reply arrives before anything is waiting
                     * for it.
                     */
                    setTimeout(() => {
                        try {
                            window.electronAPI.hardware.broadcastWeight()
                                .catch((err) => console.warn('[WeightBridge] could not seed weight:', err));
                        } catch (err) {
                            console.warn('[WeightBridge] could not seed weight:', err);
                        }
                    }, 1000);
                }

                // The real unsubscribe, not a log line: this used to discard
                // the handle from onUsbData, so calling stop left the listener
                // attached and a second start added another one on top.
                return function () {
                    if (typeof stopListening === 'function') stopListening();
                    stopListening = null;
                    console.log('[WeightBridge] Monitoring stopped');
                };
            } catch (error) {
                console.error('[WeightBridge] Error starting monitoring:', error);
                return function() {};
            }
        },

        /**
         * Check if weight machine is connected
         * @returns {Promise<boolean>}
         */
        isConnected: function() {
            return new Promise((resolve) => {
                if (!isElectron) {
                    resolve(false);
                    return;
                }

                // Try to get a weight reading to verify connection
                this.getCurrentWeight()
                    .then(weight => resolve(weight !== null))
                    .catch(() => resolve(false));
            });
        },

        /**
         * Show browser compatibility warning
         */
        showBrowserWarning: function() {
            if (!isElectron) {
                console.warn(
                    '%c[WeightBridge] Weight Machine Feature Not Available',
                    'color: orange; font-weight: bold;',
                    '\nThis feature requires the Electron desktop application.',
                    '\nPlease use the desktop app to access weight machine functionality.'
                );
            }
        }
    };

    // Expose to window
    window.WeightBridge = WeightBridge;

    // Log initialization
    if (isElectron) {
        console.log('[WeightBridge] Initialized in Electron environment - Weight machine available');
    } else {
        console.log('[WeightBridge] Initialized in browser environment - Weight machine NOT available');
    }

})(window);
