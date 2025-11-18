// Performance optimization utilities

/**
 * Spatial grid for fast neighbor queries
 * @class SpatialGrid
 */
export class SpatialGrid {
    constructor(cellSize = 100) {
        this.cellSize = cellSize;
        this.grid = new Map();
    }
    
    /**
     * Get grid key from coordinates
     * @param {number} q - Column
     * @param {number} r - Row
     * @returns {string}
     */
    getKey(q, r) {
        const gridQ = Math.floor(q / this.cellSize);
        const gridR = Math.floor(r / this.cellSize);
        return `${gridQ},${gridR}`;
    }
    
    /**
     * Add a cell to the spatial grid
     * @param {Object} cell - Cell object with q, r properties
     */
    add(cell) {
        const key = this.getKey(cell.q, cell.r);
        if (!this.grid.has(key)) {
            this.grid.set(key, []);
        }
        this.grid.get(key).push(cell);
    }
    
    /**
     * Get cells in a region
     * @param {number} q - Center column
     * @param {number} r - Center row
     * @param {number} radius - Search radius
     * @returns {Array}
     */
    getNearby(q, r, radius = 1) {
        const results = [];
        const minQ = Math.floor((q - radius) / this.cellSize);
        const maxQ = Math.floor((q + radius) / this.cellSize);
        const minR = Math.floor((r - radius) / this.cellSize);
        const maxR = Math.floor((r + radius) / this.cellSize);
        
        for (let gridQ = minQ; gridQ <= maxQ; gridQ++) {
            for (let gridR = minR; gridR <= maxR; gridR++) {
                const key = `${gridQ},${gridR}`;
                const cells = this.grid.get(key);
                if (cells) {
                    results.push(...cells);
                }
            }
        }
        
        return results;
    }
    
    /**
     * Clear the grid
     */
    clear() {
        this.grid.clear();
    }
    
    /**
     * Rebuild the grid from a cell map
     * @param {Map} cells - Map of cells
     */
    rebuild(cells) {
        this.clear();
        for (const cell of cells.values()) {
            this.add(cell);
        }
    }
}

/**
 * Dirty cell tracker for efficient rendering
 * @class DirtyCellTracker
 */
export class DirtyCellTracker {
    constructor() {
        this.dirtyCells = new Set();
        this.dirtyBees = new Set();
    }
    
    /**
     * Mark a cell as dirty
     * @param {Object} cell - Cell to mark dirty
     */
    markDirty(cell) {
        if (cell && cell.q !== undefined && cell.r !== undefined) {
            this.dirtyCells.add(`${cell.q},${cell.r}`);
        }
    }
    
    /**
     * Mark a bee as dirty (needs re-render)
     * @param {Object} bee - Bee to mark dirty
     */
    markBeeDirty(bee) {
        if (bee) {
            this.dirtyBees.add(bee);
        }
    }
    
    /**
     * Check if a cell is dirty
     * @param {Object} cell - Cell to check
     * @returns {boolean}
     */
    isDirty(cell) {
        if (!cell) return false;
        return this.dirtyCells.has(`${cell.q},${cell.r}`);
    }
    
    /**
     * Clear all dirty flags
     */
    clear() {
        this.dirtyCells.clear();
        this.dirtyBees.clear();
    }
    
    /**
     * Get all dirty cell keys
     * @returns {Set<string>}
     */
    getDirtyCells() {
        return this.dirtyCells;
    }
    
    /**
     * Get all dirty bees
     * @returns {Set<Object>}
     */
    getDirtyBees() {
        return this.dirtyBees;
    }
}

/**
 * Viewport culler for rendering optimization
 * @class ViewportCuller
 */
export class ViewportCuller {
    constructor(hexSize, offsetX, offsetY) {
        this.hexSize = hexSize || 20;
        this.offsetX = offsetX || 0;
        this.offsetY = offsetY || 0;
        this.padding = 50; // Extra padding for smooth scrolling
    }
    
    /**
     * Check if a cell is visible in the viewport
     * @param {Object} cell - Cell to check
     * @param {number} canvasWidth - Canvas width
     * @param {number} canvasHeight - Canvas height
     * @returns {boolean}
     */
    isVisible(cell, canvasWidth, canvasHeight) {
        if (!cell || !canvasWidth || !canvasHeight) return true; // Default to visible if invalid
        
        // Get cell position
        const pos = this.hexToPixel(cell.q, cell.r);
        const x = pos.x + this.offsetX;
        const y = pos.y + this.offsetY;
        
        // Check if cell is within viewport (with padding)
        const hexRadius = this.hexSize;
        return (
            x + hexRadius >= -this.padding &&
            x - hexRadius <= canvasWidth + this.padding &&
            y + hexRadius >= -this.padding &&
            y - hexRadius <= canvasHeight + this.padding
        );
    }
    
    /**
     * Convert hex coordinates to pixel (simplified version matching utils.js)
     * @param {number} q - Column
     * @param {number} r - Row
     * @returns {{x: number, y: number}}
     */
    hexToPixel(q, r) {
        if (typeof q !== 'number' || typeof r !== 'number' || !isFinite(q) || !isFinite(r)) {
            return { x: 0, y: 0 };
        }
        const hexWidth = this.hexSize * 2;
        const hexHeight = this.hexSize * Math.sqrt(3);
        const x = q * hexWidth * 0.75;
        const y = r * hexHeight + (q % 2) * (hexHeight / 2);
        return { x, y };
    }
    
    /**
     * Update viewport parameters
     * @param {number} hexSize - Hex size
     * @param {number} offsetX - X offset
     * @param {number} offsetY - Y offset
     */
    update(hexSize, offsetX, offsetY) {
        this.hexSize = hexSize || this.hexSize || 20;
        this.offsetX = offsetX || 0;
        this.offsetY = offsetY || 0;
        // Update viewport dimensions based on canvas size
        const canvas = document.getElementById('hiveCanvas');
        if (canvas) {
            this.viewport = {
                x: 0,
                y: 0,
                width: canvas.width,
                height: canvas.height
            };
        }
    }
}

/**
 * Pathfinding cache for common routes
 * @class PathfindingCache
 */
export class PathfindingCache {
    constructor(maxSize = 100) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.hits = 0;
        this.misses = 0;
    }
    
    /**
     * Get cache key from start and end positions
     * @param {Object} start - Start position {q, r}
     * @param {Object} end - End position {q, r}
     * @returns {string}
     */
    getKey(start, end) {
        return `${start.q},${start.r}:${end.q},${end.r}`;
    }
    
    /**
     * Get cached path
     * @param {Object} start - Start position
     * @param {Object} end - End position
     * @returns {Array|null} Cached path or null
     */
    get(start, end) {
        const key = this.getKey(start, end);
        const cached = this.cache.get(key);
        if (cached) {
            this.hits++;
            return cached;
        }
        this.misses++;
        return null;
    }
    
    /**
     * Store a path in cache
     * @param {Object} start - Start position
     * @param {Object} end - End position
     * @param {Array} path - Path to cache
     */
    set(start, end, path) {
        if (this.cache.size >= this.maxSize) {
            // Remove oldest entry (simple FIFO)
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        const key = this.getKey(start, end);
        this.cache.set(key, path);
    }
    
    /**
     * Clear the cache
     */
    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }
    
    /**
     * Get cache statistics
     * @returns {{size: number, hits: number, misses: number, hitRate: number}}
     */
    getStats() {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0
        };
    }
}

/**
 * Update batcher for spreading work across frames
 * @class UpdateBatcher
 */
export class UpdateBatcher {
    constructor(batchSize = 10) {
        this.batchSize = batchSize;
        this.queue = [];
        this.processing = false;
    }
    
    /**
     * Add an update function to the batch
     * @param {Function} updateFn - Function to call for update
     * @param {*} context - Context (bee, cell, etc.)
     */
    add(updateFn, context) {
        this.queue.push({ updateFn, context });
    }
    
    /**
     * Process a batch of updates
     * @returns {number} Number of items processed
     */
    processBatch() {
        if (this.queue.length === 0) return 0;
        
        const batch = this.queue.splice(0, this.batchSize);
        for (const item of batch) {
            try {
                item.updateFn(item.context);
            } catch (error) {
                console.error('Error in batched update:', error);
            }
        }
        
        return batch.length;
    }
    
    /**
     * Clear the queue
     */
    clear() {
        this.queue = [];
    }
    
    /**
     * Get queue length
     * @returns {number}
     */
    getLength() {
        return this.queue.length;
    }
}

/**
 * Object pool for reducing allocations
 * @class ObjectPool
 */
export class ObjectPool {
    constructor(createFn, resetFn, initialSize = 10) {
        this.createFn = createFn;
        this.resetFn = resetFn;
        this.pool = [];
        this.active = new Set();
        
        // Pre-populate pool
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(createFn());
        }
    }
    
    /**
     * Get an object from the pool
     * @returns {*}
     */
    acquire() {
        let obj;
        if (this.pool.length > 0) {
            obj = this.pool.pop();
        } else {
            obj = this.createFn();
        }
        
        this.active.add(obj);
        return obj;
    }
    
    /**
     * Return an object to the pool
     * @param {*} obj - Object to return
     */
    release(obj) {
        if (this.active.has(obj)) {
            this.active.delete(obj);
            if (this.resetFn) {
                this.resetFn(obj);
            }
            this.pool.push(obj);
        }
    }
    
    /**
     * Clear the pool
     */
    clear() {
        this.pool = [];
        this.active.clear();
    }
}

/**
 * Performance monitor for tracking FPS and frame times
 * @class PerformanceMonitor
 */
export class PerformanceMonitor {
    constructor() {
        this.frameTimes = [];
        this.maxSamples = 60;
        this.lastFrameTime = performance.now();
        this.fps = 0;
    }
    
    /**
     * Record a frame
     */
    recordFrame() {
        const now = performance.now();
        const frameTime = now - this.lastFrameTime;
        this.lastFrameTime = now;
        
        this.frameTimes.push(frameTime);
        if (this.frameTimes.length > this.maxSamples) {
            this.frameTimes.shift();
        }
        
        // Calculate average FPS
        if (this.frameTimes.length > 0) {
            const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
            this.fps = Math.round(1000 / avgFrameTime);
        }
    }
    
    /**
     * Get current FPS
     * @returns {number}
     */
    getFPS() {
        return this.fps;
    }
    
    /**
     * Get average frame time
     * @returns {number}
     */
    getAvgFrameTime() {
        if (this.frameTimes.length === 0) return 0;
        return this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    }
    
    /**
     * Reset statistics
     */
    reset() {
        this.frameTimes = [];
        this.fps = 0;
    }
}

