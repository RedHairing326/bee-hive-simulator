// Configuration validator with helpful error messages

/**
 * Validates configuration object and returns validation result
 * @param {Object} config - Configuration object to validate
 * @returns {{valid: boolean, errors: Array<string>, warnings: Array<string>}}
 */
export function validateConfig(config) {
    const errors = [];
    const warnings = [];
    
    if (!config || typeof config !== 'object') {
        errors.push('Configuration is missing or invalid');
        return { valid: false, errors, warnings };
    }
    
    // Validate grid settings
    if (!config.grid) {
        errors.push('Missing "grid" configuration');
    } else {
        const grid = config.grid;
        
        if (typeof grid.columns !== 'number' || grid.columns < 1 || grid.columns > 200) {
            errors.push('grid.columns must be a number between 1 and 200');
        }
        
        if (typeof grid.rows !== 'number' || grid.rows < 1 || grid.rows > 200) {
            errors.push('grid.rows must be a number between 1 and 200');
        }
        
        if (typeof grid.hexSize !== 'number' || grid.hexSize < 5 || grid.hexSize > 100) {
            errors.push('grid.hexSize must be a number between 5 and 100');
        }
        
        if (grid.columns * grid.rows > 10000) {
            warnings.push('Large grid size may impact performance');
        }
    }
    
    // Validate simulation settings
    if (!config.simulation) {
        errors.push('Missing "simulation" configuration');
    } else {
        const sim = config.simulation;
        
        if (typeof sim.initialWorkerCount !== 'number' || sim.initialWorkerCount < 0) {
            errors.push('simulation.initialWorkerCount must be a non-negative number');
        }
        
        if (typeof sim.workerLifespan !== 'number' || sim.workerLifespan <= 0) {
            errors.push('simulation.workerLifespan must be a positive number');
        }
        
        if (typeof sim.queenLifespan !== 'number' || sim.queenLifespan <= 0) {
            errors.push('simulation.queenLifespan must be a positive number');
        }
        
        if (sim.initialWorkerCount > 1000) {
            warnings.push('Very high initial worker count may impact performance');
        }
    }
    
    // Validate environment settings
    if (!config.environment) {
        errors.push('Missing "environment" configuration');
    } else {
        const env = config.environment;
        
        if (!env.seasonalMultipliers || typeof env.seasonalMultipliers !== 'object') {
            errors.push('environment.seasonalMultipliers must be an object');
        } else {
            const requiredSeasons = ['spring', 'summer', 'fall', 'winter'];
            for (const season of requiredSeasons) {
                if (typeof env.seasonalMultipliers[season] !== 'number') {
                    errors.push(`environment.seasonalMultipliers.${season} must be a number`);
                }
            }
        }
        
        if (!env.hourlyActivityMultipliers || typeof env.hourlyActivityMultipliers !== 'object') {
            errors.push('environment.hourlyActivityMultipliers must be an object');
        } else {
            for (let hour = 0; hour < 24; hour++) {
                if (typeof env.hourlyActivityMultipliers[hour.toString()] !== 'number') {
                    warnings.push(`Missing hourly activity multiplier for hour ${hour}`);
                }
            }
        }
    }
    
    // Validate UI settings
    if (config.ui) {
        const ui = config.ui;
        
        if (typeof ui.targetFPS !== 'undefined' && (typeof ui.targetFPS !== 'number' || ui.targetFPS < 1 || ui.targetFPS > 120)) {
            errors.push('ui.targetFPS must be a number between 1 and 120');
        }
        
        if (typeof ui.maxTimeMultiplier !== 'undefined' && (typeof ui.maxTimeMultiplier !== 'number' || ui.maxTimeMultiplier < 1)) {
            errors.push('ui.maxTimeMultiplier must be a positive number');
        }
    }
    
    // Validate colors
    if (!config.colors) {
        warnings.push('Missing "colors" configuration - using defaults');
    } else {
        const colors = config.colors;
        
        if (colors.cellStates) {
            const requiredStates = ['empty', 'egg', 'larvaeHungry', 'larvaeFed', 'cappedBrood', 'nectar', 'honey', 'pollen'];
            for (const state of requiredStates) {
                if (!colors.cellStates[state]) {
                    warnings.push(`Missing color for cell state: ${state}`);
                } else if (!isValidColor(colors.cellStates[state])) {
                    errors.push(`Invalid color format for cellStates.${state}: ${colors.cellStates[state]}`);
                }
            }
        }
        
        if (colors.bees) {
            const requiredBeeTypes = ['queen', 'workerYoung', 'workerMiddle', 'workerOld', 'workerVeryOld'];
            for (const type of requiredBeeTypes) {
                if (!colors.bees[type]) {
                    warnings.push(`Missing color for bee type: ${type}`);
                } else if (!isValidColor(colors.bees[type])) {
                    errors.push(`Invalid color format for bees.${type}: ${colors.bees[type]}`);
                }
            }
        }
    }
    
    // Validate advanced settings
    if (config.advanced) {
        const adv = config.advanced;
        
        if (typeof adv.maxBeesPerCell !== 'undefined' && (typeof adv.maxBeesPerCell !== 'number' || adv.maxBeesPerCell < 1 || adv.maxBeesPerCell > 20)) {
            errors.push('advanced.maxBeesPerCell must be a number between 1 and 20');
        }
        
        if (typeof adv.movementSpeed !== 'undefined' && (typeof adv.movementSpeed !== 'number' || adv.movementSpeed <= 0 || adv.movementSpeed > 10)) {
            errors.push('advanced.movementSpeed must be a number between 0 and 10');
        }
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Check if a string is a valid color (hex format)
 * @param {string} color - Color string to validate
 * @returns {boolean}
 */
function isValidColor(color) {
    if (typeof color !== 'string') {
        return false;
    }
    
    // Check hex color format (#RRGGBB or #RGB)
    const hexPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    return hexPattern.test(color);
}

/**
 * Normalize and fix common configuration issues
 * @param {Object} config - Configuration to normalize
 * @returns {Object} Normalized configuration
 */
export function normalizeConfig(config) {
    if (!config) {
        return null;
    }
    
    const normalized = JSON.parse(JSON.stringify(config)); // Deep clone
    
    // Ensure required objects exist
    if (!normalized.grid) normalized.grid = {};
    if (!normalized.simulation) normalized.simulation = {};
    if (!normalized.environment) normalized.environment = {};
    if (!normalized.ui) normalized.ui = {};
    if (!normalized.advanced) normalized.advanced = {};
    if (!normalized.colors) normalized.colors = {};
    
    // Set defaults for missing values
    if (typeof normalized.grid.columns !== 'number') normalized.grid.columns = 10;
    if (typeof normalized.grid.rows !== 'number') normalized.grid.rows = 7;
    if (typeof normalized.grid.hexSize !== 'number') normalized.grid.hexSize = 40;
    
    if (typeof normalized.ui.targetFPS !== 'number') normalized.ui.targetFPS = 30;
    if (typeof normalized.ui.maxTimeMultiplier !== 'number') normalized.ui.maxTimeMultiplier = 1000;
    
    if (typeof normalized.advanced.maxBeesPerCell !== 'number') normalized.advanced.maxBeesPerCell = 9;
    if (typeof normalized.advanced.movementSpeed !== 'number') normalized.advanced.movementSpeed = 0.5;
    
    return normalized;
}

