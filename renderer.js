// Renderer for drawing the hive on canvas

import { hexToPixel } from './utils.js';
import { ViewportCuller, DirtyCellTracker } from './performance-optimizer.js';

export class Renderer {
    constructor(canvas, config) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.config = config;
        this.hexSize = config.grid.hexSize;
        this.offsetX = 0;
        this.offsetY = 0;
        
        // Performance optimizations (initialize after setupCanvas sets hexSize)
        this.viewportCuller = null; // Will be initialized in setupCanvas
        this.dirtyTracker = new DirtyCellTracker();
        this.useViewportCulling = true; // Enable by default
        this.useDirtyTracking = false; // Disabled - bees/cells don't mark themselves dirty yet
        this.fullRender = true; // Force full render on first frame
        
        this.setupCanvas();
    }
    
    calculateOptimalHexSize() {
        // Get available viewport space with minimal padding
        const viewportWidth = window.innerWidth - 60; // Small padding for borders
        const viewportHeight = window.innerHeight - 60; // Small padding for borders
        
        const cols = this.config.grid.columns;
        const rows = this.config.grid.rows;
        
        // Calculate hex size that fits width
        const hexWidth = 2; // relative to hexSize
        const horizSpacing = hexWidth * 0.75;
        const requiredWidthRatio = horizSpacing * cols + hexWidth * 0.5; // Grid width
        const hexSizeFromWidth = viewportWidth / requiredWidthRatio;
        
        // Calculate hex size that fits height
        const hexHeight = Math.sqrt(3); // relative to hexSize
        const requiredHeightRatio = hexHeight * rows + hexHeight * 0.5; // Grid height
        const hexSizeFromHeight = viewportHeight / requiredHeightRatio;
        
        // Use the smaller size to ensure both dimensions fit
        // Don't cap at config hexSize - let it scale up to fill screen
        return Math.min(hexSizeFromWidth, hexSizeFromHeight);
    }
    
    setupCanvas() {
        // Calculate optimal hex size for viewport
        this.hexSize = this.calculateOptimalHexSize();
        
        // Calculate required canvas size for hexagonal grid
        const cols = this.config.grid.columns;
        const rows = this.config.grid.rows;
        
        // Hexagon dimensions
        const hexWidth = this.hexSize * 2;
        const hexHeight = this.hexSize * Math.sqrt(3);
        
        // Horizontal spacing between hex centers
        const horizSpacing = hexWidth * 0.75;
        
        // Calculate grid dimensions
        const gridWidth = horizSpacing * cols + hexWidth * 0.5;
        const gridHeight = hexHeight * rows + hexHeight * 0.5;
        
        // Set canvas to fill viewport
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        // Center the grid in the viewport
        this.offsetX = (this.canvas.width - gridWidth) / 2 + hexWidth * 0.5;
        this.offsetY = (this.canvas.height - gridHeight) / 2 + hexHeight * 0.5;
        
        // Initialize or update viewport culler
        if (!this.viewportCuller) {
            this.viewportCuller = new ViewportCuller(this.hexSize, this.offsetX, this.offsetY);
        } else {
            this.viewportCuller.update(this.hexSize, this.offsetX, this.offsetY);
        }
    }
    
    resize() {
        // Recalculate and resize canvas
        this.setupCanvas();
        // Force full render after resize
        this.fullRender = true;
        this.dirtyTracker.clear();
    }
    
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    /**
     * Render the hive with performance optimizations
     * @param {Object} hive - Hive object
     */
    render(hive) {
        // Reset theme cache for this frame
        this.lastThemeCheck = undefined;
        
        // Initialize viewport culler if not already done
        if (!this.viewportCuller) {
            this.viewportCuller = new ViewportCuller(this.hexSize, this.offsetX, this.offsetY);
        }
        
        // Update viewport culler with current settings
        this.viewportCuller.update(this.hexSize, this.offsetX, this.offsetY);
        
        // Always do full render for now (dirty tracking disabled)
        // TODO: Re-enable dirty tracking once bees/cells mark themselves dirty
        this.clear();
        this.renderAll(hive);
        this.fullRender = false;
    }
    
    /**
     * Render all cells (full render)
     * @param {Object} hive - Hive object
     */
    renderAll(hive) {
        if (!hive || !hive.cells) return;
        
        const visibleCells = [];
        const cellsWithBees = [];
        const movingBees = [];
        
        const canvasWidth = this.canvas ? this.canvas.width : window.innerWidth;
        const canvasHeight = this.canvas ? this.canvas.height : window.innerHeight;
        
        // Collect visible cells and bees
        for (const cell of hive.cells.values()) {
            if (!cell) continue;
            
            if (!this.useViewportCulling || !this.viewportCuller ||
                this.viewportCuller.isVisible(cell, canvasWidth, canvasHeight)) {
                visibleCells.push(cell);
                
                if (cell.occupyingBees && cell.occupyingBees.length > 0 || cell.hasDeadBee()) {
                    cellsWithBees.push(cell);
                }
            }
        }
        
        // Collect moving bees
        if (hive.bees && Array.isArray(hive.bees)) {
            for (const bee of hive.bees) {
                if (!bee || bee.isOutsideHive || bee.moveProgress >= 1.0) continue;
                
                // Check if bee is visible
                const cell = hive.getCell ? hive.getCell(bee.q, bee.r) : null;
                if (!this.useViewportCulling || !this.viewportCuller ||
                    !cell || 
                    this.viewportCuller.isVisible(cell, canvasWidth, canvasHeight)) {
                    movingBees.push(bee);
                }
            }
        }
        
        // Draw visible cells
        for (const cell of visibleCells) {
            this.drawCell(cell, hive);
        }
        
        // Draw bees in cells
        for (const cell of cellsWithBees) {
            this.drawBeesInCell(cell);
        }
        
        // Draw moving bees
        for (const bee of movingBees) {
            this.drawBee(bee);
        }
    }
    
    /**
     * Render only dirty cells (incremental render)
     * @param {Object} hive - Hive object
     */
    renderDirty(hive) {
        if (!hive || !hive.getCell) return;
        
        const dirtyCells = this.dirtyTracker.getDirtyCells();
        const dirtyBees = this.dirtyTracker.getDirtyBees();
        
        // Redraw dirty cells
        for (const cellKey of dirtyCells) {
            const [q, r] = cellKey.split(',').map(Number);
            if (isNaN(q) || isNaN(r)) continue;
            
            const cell = hive.getCell(q, r);
            if (cell) {
                // Clear cell area (approximate)
                const pos = hexToPixel(cell.q, cell.r, this.hexSize);
                const x = pos.x + this.offsetX;
                const y = pos.y + this.offsetY;
                const hexRadius = this.hexSize * 1.2; // Slightly larger to ensure clean
                
                // Clear the area
                this.ctx.save();
                this.ctx.beginPath();
                this.ctx.arc(x, y, hexRadius, 0, Math.PI * 2);
                this.ctx.clip();
                this.ctx.clearRect(x - hexRadius, y - hexRadius, hexRadius * 2, hexRadius * 2);
                this.ctx.restore();
                
                // Redraw cell
                this.drawCell(cell, hive);
                
                // Redraw bees in cell
                if (cell.occupyingBees && cell.occupyingBees.length > 0 || cell.hasDeadBee()) {
                    this.drawBeesInCell(cell);
                }
            }
        }
        
        // Redraw dirty moving bees
        for (const bee of dirtyBees) {
            if (!bee.isOutsideHive && bee.moveProgress < 1.0) {
                // Clear previous position (if needed)
                // For simplicity, we'll just redraw
                this.drawBee(bee);
            }
        }
        
        // Clear dirty flags after rendering
        this.dirtyTracker.clear();
    }
    
    /**
     * Mark a cell as dirty (needs re-render)
     * @param {Object} cell - Cell to mark dirty
     */
    markDirty(cell) {
        if (this.useDirtyTracking) {
            this.dirtyTracker.markDirty(cell);
        }
    }
    
    /**
     * Mark a bee as dirty (needs re-render)
     * @param {Object} bee - Bee to mark dirty
     */
    markBeeDirty(bee) {
        if (this.useDirtyTracking) {
            this.dirtyTracker.markBeeDirty(bee);
        }
    }
    
    /**
     * Force a full render on next frame
     */
    forceFullRender() {
        this.fullRender = true;
    }
    
    drawCell(cell, hive) {
        const pos = hexToPixel(cell.q, cell.r, this.hexSize);
        const x = pos.x + this.offsetX;
        const y = pos.y + this.offsetY;
        
        const isEntrance = hive && hive.isEntranceCell(cell.q, cell.r);
        
        // Cache theme check (only check once per render cycle)
        if (this.lastThemeCheck === undefined) {
            this.lastThemeCheck = document.body.classList.contains('dark-mode');
        }
        const isDark = this.lastThemeCheck;
        
        // Draw hexagon background (neutral color)
        this.ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i;
            const hx = x + this.hexSize * Math.cos(angle);
            const hy = y + this.hexSize * Math.sin(angle);
            
            if (i === 0) {
                this.ctx.moveTo(hx, hy);
            } else {
                this.ctx.lineTo(hx, hy);
            }
        }
        this.ctx.closePath();
        
        // Fill with neutral background (theme-aware)
        if (isEntrance) {
            // Entrance cells have a slightly different tint
            this.ctx.fillStyle = isDark ? '#3a3a2a' : '#ffffea';
        } else {
            this.ctx.fillStyle = isDark ? 
                this.config.colors.background.cellFillDark : 
                this.config.colors.background.cellFillLight;
        }
        this.ctx.fill();
        
        // Draw colored hexagonal RING based on cell state
        // This is the main indicator of cell status
        const ringWidth = this.getRingWidth(cell);
        const cellColor = cell.getColor();
        
        // Batch stroke operations with same style
        this.ctx.strokeStyle = cellColor;
        this.ctx.lineWidth = ringWidth;
        this.ctx.stroke();
        
        // Draw entrance indicator
        if (isEntrance) {
            this.ctx.strokeStyle = '#90EE90';
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
        }
        
        // Draw inner border for definition
        this.ctx.strokeStyle = this.config.colors.borders.default;
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
        
        // Draw development progress ring for brood (additional visual indicator)
        if (cell.isBrood()) {
            const progress = cell.getDevelopmentProgress();
            this.drawProgressRing(x, y, progress);
        }
        
        // Draw content amount indicator for food storage
        if (cell.isFood() && cell.contentAmount > 0) {
            this.drawContentIndicator(x, y, cell.contentAmount / 10);
        }
        
        // Draw dirty cell indicator
        if (cell.isDirty) {
            this.drawDirtyIndicator(x, y);
        }
    }
    
    getRingWidth(cell) {
        // Thicker rings for important states
        if (cell.state === 'empty') {
            return 2;
        } else if (cell.isBrood()) {
            return 6;
        } else if (cell.isFood()) {
            return 5;
        }
        return 4;
    }
    
    drawBeesInCell(cell) {
        // Draw multiple bees in a 3x3 grid pattern
        const pos = hexToPixel(cell.q, cell.r, this.hexSize);
        const centerX = pos.x + this.offsetX;
        const centerY = pos.y + this.offsetY;
        
        // Include dead bees as "bees" to draw (will be rendered as red X)
        const bees = [...cell.occupyingBees];
        for (let i = 0; i < cell.deadBeeCount; i++) {
            // Create a fake bee object for each dead bee
            bees.push({ 
                type: 'dead', 
                isDead: true,
                getColor: () => '#FF0000' // Not used but ensures compatibility
            });
        }
        
        const beeCount = bees.length;
        
        if (beeCount === 0) return;
        
        // Define 3x3 grid positions (relative to cell center)
        const gridSize = this.hexSize * 0.35; // Spacing between dots
        const gridPositions = [
            { x: -gridSize, y: -gridSize }, // top-left
            { x: 0, y: -gridSize },          // top-center
            { x: gridSize, y: -gridSize },   // top-right
            { x: -gridSize, y: 0 },          // middle-left
            { x: 0, y: 0 },                  // center
            { x: gridSize, y: 0 },           // middle-right
            { x: -gridSize, y: gridSize },   // bottom-left
            { x: 0, y: gridSize },           // bottom-center
            { x: gridSize, y: gridSize }     // bottom-right
        ];
        
        // If only one bee, draw at center
        if (beeCount === 1) {
            this.drawBeeAtPosition(bees[0], centerX, centerY);
            return;
        }
        
        // Prioritize queen - if queen is present, put her at center position
        const sortedBees = [...bees];
        const queenIndex = sortedBees.findIndex(b => b.type === 'queen');
        
        // For 2-4 bees, ensure queen is at center if present
        if (beeCount >= 2 && beeCount <= 4) {
            if (queenIndex > -1 && beeCount === 2) {
                // For 2 bees, keep queen first
                if (queenIndex === 1) {
                    [sortedBees[0], sortedBees[1]] = [sortedBees[1], sortedBees[0]];
                }
            } else if (queenIndex > -1 && beeCount > 2) {
                // For 3-4 bees, put queen at position that looks central
                const centerPos = beeCount === 3 ? 1 : 1; // Index 1 for both
                if (queenIndex !== centerPos) {
                    [sortedBees[queenIndex], sortedBees[centerPos]] = [sortedBees[centerPos], sortedBees[queenIndex]];
                }
            }
        } else if (queenIndex > -1 && beeCount > 4 && queenIndex !== 4) {
            // For 5+ bees, swap queen with bee at center position (index 4)
            [sortedBees[queenIndex], sortedBees[4]] = [sortedBees[4], sortedBees[queenIndex]];
        }
        
        // Draw bees at grid positions with appropriate sizing
        // Scale down bee size based on how many bees are in the cell
        const isQueen = sortedBees.some(b => b.type === 'queen');
        const baseRadius = beeCount <= 2 ? 5 : (beeCount <= 4 ? 4 : 3.5);
        const queenRadius = beeCount <= 2 ? 7 : (beeCount <= 4 ? 6 : 5);
        
        for (let i = 0; i < Math.min(beeCount, 9); i++) {
            const bee = sortedBees[i];
            const gridPos = gridPositions[i];
            const x = centerX + gridPos.x;
            const y = centerY + gridPos.y;
            
            const radius = bee.type === 'queen' ? queenRadius : baseRadius;
            this.drawBeeAtPosition(bee, x, y, radius);
        }
    }
    
    drawBeeAtPosition(bee, x, y, radius = null) {
        const isQueen = bee.type === 'queen';
        const isDead = bee.isDead || bee.type === 'dead';
        
        // Use provided radius or default
        if (radius === null) {
            radius = isQueen ? 8 : 5;
        }
        
        // Draw dead bee as red X instead of circle
        if (isDead) {
            const size = radius * 0.8;
            this.ctx.strokeStyle = '#FF0000';
            this.ctx.lineWidth = 2.5;
            this.ctx.lineCap = 'round';
            
            // Draw X
            this.ctx.beginPath();
            this.ctx.moveTo(x - size, y - size);
            this.ctx.lineTo(x + size, y + size);
            this.ctx.moveTo(x + size, y - size);
            this.ctx.lineTo(x - size, y + size);
            this.ctx.stroke();
            return; // Don't draw cargo indicators for dead bees
        }
        
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = bee.getColor();
        this.ctx.fill();
        
        // Add a white outline for visibility (stronger for queen)
        this.ctx.strokeStyle = isQueen ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.7)';
        this.ctx.lineWidth = isQueen ? 1.5 : 1;
        this.ctx.stroke();
        
        // Draw small indicator if carrying nectar/pollen/water/food/dead bee
        if (bee.hasNectar || bee.hasPollen || bee.hasWater || bee.hasFood || bee.hasDeadBee) {
            const indicatorSize = radius * 0.35;
            const indicatorOffset = radius * 0.8;
            
            // Draw red X for carrying dead bee
            if (bee.hasDeadBee) {
                const xSize = indicatorSize * 0.7;
                const xX = x + indicatorOffset;
                const xY = y - indicatorOffset;
                
                this.ctx.strokeStyle = '#FF0000';
                this.ctx.lineWidth = 2;
                this.ctx.lineCap = 'round';
                
                this.ctx.beginPath();
                this.ctx.moveTo(xX - xSize, xY - xSize);
                this.ctx.lineTo(xX + xSize, xY + xSize);
                this.ctx.moveTo(xX + xSize, xY - xSize);
                this.ctx.lineTo(xX - xSize, xY + xSize);
                this.ctx.stroke();
            } else {
                // Draw circular cargo indicator for other items
                this.ctx.beginPath();
                this.ctx.arc(x + indicatorOffset, y - indicatorOffset, indicatorSize, 0, Math.PI * 2);
                // Priority: nectar > water > food > pollen for display
                if (bee.hasNectar) {
                    this.ctx.fillStyle = '#87CEEB'; // Light blue for nectar
                } else if (bee.hasWater) {
                    this.ctx.fillStyle = '#00CED1'; // Dark turquoise for water
                } else if (bee.hasFood) {
                    this.ctx.fillStyle = '#FFD700'; // Gold for food (honey/pollen for feeding)
                } else {
                    this.ctx.fillStyle = '#FFA500'; // Orange for pollen
                }
                this.ctx.fill();
            }
        }
    }
    
    drawBee(bee) {
        // Use display position for smooth movement (for bees mid-transit)
        // Interpolate in PIXEL space, not coordinate space, for smooth movement
        
        // Don't draw bees that are outside the hive
        if (bee.isOutsideHive) {
            return;
        }
        
        let x, y;
        
        if (bee.moveProgress < 1.0) {
            // Bee is moving - interpolate in pixel space
            const startPos = hexToPixel(bee.q, bee.r, this.hexSize);
            const endPos = hexToPixel(bee.targetQ, bee.targetR, this.hexSize);
            
            const t = bee.moveProgress;
            x = startPos.x + (endPos.x - startPos.x) * t + this.offsetX;
            y = startPos.y + (endPos.y - startPos.y) * t + this.offsetY;
        } else {
            // Bee is stationary
            const pos = hexToPixel(bee.q, bee.r, this.hexSize);
            x = pos.x + this.offsetX;
            y = pos.y + this.offsetY;
        }
        
        this.drawBeeAtPosition(bee, x, y);
    }
    
    drawProgressRing(x, y, progress) {
        const radius = this.hexSize * 0.7;
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + (Math.PI * 2 * progress);
        
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, startAngle, endAngle);
        this.ctx.strokeStyle = this.config.colors.borders.highlight;
        this.ctx.lineWidth = 3;
        this.ctx.stroke();
    }
    
    drawContentIndicator(x, y, fillRatio) {
        // Draw a small arc to indicate fullness
        const radius = this.hexSize * 0.75;
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + (Math.PI * 2 * fillRatio);
        
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, startAngle, endAngle);
        this.ctx.strokeStyle = this.config.colors.borders.highlight;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
    }
    
    drawDirtyIndicator(x, y) {
        // Draw a small brown/dirty circle in the lower-left corner
        const offset = this.hexSize * 0.5;
        const centerX = x - offset;
        const centerY = y + offset;
        const radius = this.hexSize * 0.15;
        
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = '#8B4513';
        this.ctx.fill();
    }
    
    updateHexSize(newSize) {
        this.hexSize = newSize;
        this.config.grid.hexSize = newSize;
        this.setupCanvas();
    }
}

