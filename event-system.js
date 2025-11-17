// Event system for decoupled communication between components

/**
 * Simple event emitter for decoupled component communication
 * @class EventEmitter
 */
export class EventEmitter {
    constructor() {
        /** @type {Map<string, Array<Function>>} */
        this.listeners = new Map();
    }
    
    /**
     * Subscribe to an event
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (typeof callback !== 'function') {
            console.warn(`EventEmitter.on: callback must be a function for event "${event}"`);
            return () => {};
        }
        
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        
        this.listeners.get(event).push(callback);
        
        // Return unsubscribe function
        return () => {
            const callbacks = this.listeners.get(event);
            if (callbacks) {
                const index = callbacks.indexOf(callback);
                if (index > -1) {
                    callbacks.splice(index, 1);
                }
            }
        };
    }
    
    /**
     * Subscribe to an event once
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     */
    once(event, callback) {
        const wrapper = (...args) => {
            callback(...args);
            this.off(event, wrapper);
        };
        this.on(event, wrapper);
    }
    
    /**
     * Unsubscribe from an event
     * @param {string} event - Event name
     * @param {Function} callback - Callback function (optional)
     */
    off(event, callback) {
        if (!this.listeners.has(event)) {
            return;
        }
        
        if (callback) {
            const callbacks = this.listeners.get(event);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        } else {
            // Remove all listeners for this event
            this.listeners.delete(event);
        }
    }
    
    /**
     * Emit an event
     * @param {string} event - Event name
     * @param {...any} args - Arguments to pass to listeners
     */
    emit(event, ...args) {
        if (!this.listeners.has(event)) {
            return;
        }
        
        const callbacks = [...this.listeners.get(event)]; // Copy array to avoid issues if listeners modify during iteration
        
        for (const callback of callbacks) {
            try {
                callback(...args);
            } catch (error) {
                console.error(`Error in event listener for "${event}":`, error);
            }
        }
    }
    
    /**
     * Remove all listeners
     */
    removeAllListeners() {
        this.listeners.clear();
    }
    
    /**
     * Get number of listeners for an event
     * @param {string} event - Event name
     * @returns {number}
     */
    listenerCount(event) {
        return this.listeners.has(event) ? this.listeners.get(event).length : 0;
    }
}

// Global event emitter instance
export const events = new EventEmitter();

// Event names constants
export const EventNames = {
    // Simulation events
    SIMULATION_START: 'simulation:start',
    SIMULATION_PAUSE: 'simulation:pause',
    SIMULATION_RESUME: 'simulation:resume',
    SIMULATION_RESET: 'simulation:reset',
    SIMULATION_ERROR: 'simulation:error',
    
    // Bee events
    BEE_BORN: 'bee:born',
    BEE_DIED: 'bee:died',
    BEE_TASK_CHANGED: 'bee:taskChanged',
    
    // Queen events
    QUEEN_EGG_LAID: 'queen:eggLaid',
    QUEEN_DIED: 'queen:died',
    QUEEN_CREATED: 'queen:created',
    
    // Hive events
    HIVE_TEMPERATURE_CHANGED: 'hive:temperatureChanged',
    HIVE_FOOD_LOW: 'hive:foodLow',
    HIVE_POPULATION_CHANGED: 'hive:populationChanged',
    
    // Cell events
    CELL_STATE_CHANGED: 'cell:stateChanged',
    CELL_BROOD_EMERGED: 'cell:broodEmerged',
    
    // UI events
    UI_CONFIG_CHANGED: 'ui:configChanged',
    UI_THEME_CHANGED: 'ui:themeChanged',
    UI_MOBILE_MODE_CHANGED: 'ui:mobileModeChanged',
    
    // Error events
    ERROR_CONFIG_INVALID: 'error:configInvalid',
    ERROR_RENDER_FAILED: 'error:renderFailed',
    ERROR_SIMULATION_FAILED: 'error:simulationFailed'
};

