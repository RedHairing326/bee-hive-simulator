// Main entry point for the bee hive simulator

import { Hive } from './hive.js';
import { Renderer } from './renderer.js';
import { getSeason, formatTime, formatDate, isDarkMode } from './utils.js';

class BeeHiveSimulator {
    constructor() {
        this.config = null;
        this.hive = null;
        this.renderer = null;
        this.canvas = null;
        this.lastTimestamp = 0;
        this.timeMultiplier = 1;
        this.simulationDate = new Date();
        this.elapsedSimulationTime = 0; // Track total simulation time in seconds
        this.running = false;
        
        this.init();
    }
    
    async init() {
        // Load configuration
        await this.loadConfig();
        
        // Setup canvas
        this.canvas = document.getElementById('hiveCanvas');
        
        // Create hive and renderer
        this.hive = new Hive(this.config);
        this.renderer = new Renderer(this.canvas, this.config);
        
        // Setup UI
        this.setupUI();
        
        // Setup window resize handler
        this.setupResizeHandler();
        
        // Set initial time
        if (this.config.ui.useCurrentTime) {
            this.simulationDate = new Date();
        }
        
        // Start simulation
        this.running = true;
        this.lastTimestamp = performance.now();
        requestAnimationFrame((t) => this.gameLoop(t));
    }
    
    setupResizeHandler() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            // Debounce resize events
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (this.renderer) {
                    this.renderer.resize();
                    this.renderer.render(this.hive);
                }
            }, 250);
        });
    }
    
    setupCollapsiblePanels() {
        const panels = document.querySelectorAll('.panel');
        
        // Helper function to update tab visibility for a specific panel
        const updateTabVisibility = (panel) => {
            const panelId = panel.id;
            const tab = document.getElementById(`${panelId}-tab`);
            
            if (tab) {
                // Hide tab when panel is expanded (not collapsed) OR pinned
                if (!panel.classList.contains('collapsed') || panel.classList.contains('pinned')) {
                    tab.classList.add('hidden');
                } else {
                    tab.classList.remove('hidden');
                }
            }
        };
        
        panels.forEach(panel => {
            const pinBtn = panel.querySelector('.pin-btn');
            let hoverTimeout;
            
            // Pin button handler (mouse and touch)
            const handlePinToggle = (e) => {
                e.stopPropagation();
                e.preventDefault();
                panel.classList.toggle('pinned');
                
                if (panel.classList.contains('pinned')) {
                    panel.classList.remove('collapsed');
                }
                
                updateTabVisibility(panel);
            };
            
            if (pinBtn) {
                pinBtn.addEventListener('click', handlePinToggle);
                pinBtn.addEventListener('touchend', handlePinToggle);
            }
            
            // Hover to expand (only if not pinned)
            panel.addEventListener('mouseenter', () => {
                if (!panel.classList.contains('pinned')) {
                    clearTimeout(hoverTimeout);
                    panel.classList.remove('collapsed');
                    updateTabVisibility(panel);
                }
            });
            
            // Touch to expand (only if not pinned)
            panel.addEventListener('touchstart', (e) => {
                // Stop propagation to prevent document-level touch handler from closing it
                e.stopPropagation();
                if (!panel.classList.contains('pinned')) {
                    clearTimeout(hoverTimeout);
                    panel.classList.remove('collapsed');
                    updateTabVisibility(panel);
                }
            });
            
            // Collapse on leave (only if not pinned)
            panel.addEventListener('mouseleave', () => {
                if (!panel.classList.contains('pinned')) {
                    hoverTimeout = setTimeout(() => {
                        panel.classList.add('collapsed');
                        updateTabVisibility(panel);
                    }, 300); // Small delay before collapsing
                }
            });
            
            // Initial visibility update
            updateTabVisibility(panel);
        });
        
        // Close panels when tapping outside (touch devices only)
        document.addEventListener('touchstart', (e) => {
            // Check if touch is outside all panels and tabs
            const touchedPanel = e.target.closest('.panel');
            const touchedTab = e.target.closest('.panel-tab');
            
            // If touched outside panels and tabs, collapse all unpinned panels
            if (!touchedPanel && !touchedTab) {
                panels.forEach(panel => {
                    if (!panel.classList.contains('pinned')) {
                        panel.classList.add('collapsed');
                        updateTabVisibility(panel);
                    }
                });
            }
        }, { passive: true });
        
        // Setup panel tabs (clickable indicators)
        const tabs = document.querySelectorAll('.panel-tab');
        tabs.forEach(tab => {
            const panelId = tab.id.replace('-tab', '');
            const panel = document.getElementById(panelId);
            
            if (panel) {
                // Handler to toggle pin (mouse and touch)
                const handleTabClick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    panel.classList.toggle('pinned');
                    if (panel.classList.contains('pinned')) {
                        panel.classList.remove('collapsed');
                    }
                    updateTabVisibility(panel);
                };
                
                // Click/tap tab to toggle pin
                tab.addEventListener('click', handleTabClick);
                tab.addEventListener('touchend', handleTabClick);
                
                // Prevent tab touches from closing panels
                tab.addEventListener('touchstart', (e) => {
                    e.stopPropagation();
                });
                
                // Hover tab to show panel temporarily
                tab.addEventListener('mouseenter', () => {
                    if (!panel.classList.contains('pinned')) {
                        panel.classList.remove('collapsed');
                        updateTabVisibility(panel);
                    }
                });
            }
        });
        
        // Setup tooltip positioning for legend items
        const legendItems = document.querySelectorAll('.legend-item');
        legendItems.forEach(item => {
            item.addEventListener('mouseenter', (e) => {
                const tooltip = item.querySelector('.tooltip');
                if (tooltip) {
                    const rect = item.getBoundingClientRect();
                    // Position tooltip to the left of the legend item
                    tooltip.style.left = (rect.left - 230) + 'px'; // 220px width + 10px gap
                    tooltip.style.top = (rect.top + rect.height / 2) + 'px';
                    tooltip.style.transform = 'translateY(-50%)';
                }
            });
        });
        
        // Setup cell hover tooltip
        this.setupCellTooltip();
    }
    
    setupCellTooltip() {
        const canvas = document.getElementById('hiveCanvas');
        const tooltip = document.getElementById('cell-tooltip');
        
        if (!canvas || !tooltip) return;
        
        // Shared handler for mouse and touch events
        const handlePointerMove = (clientX, clientY) => {
            if (!this.hive || !this.renderer) return;
            
            const rect = canvas.getBoundingClientRect();
            
            // Account for canvas scaling
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            
            const mouseX = (clientX - rect.left) * scaleX;
            const mouseY = (clientY - rect.top) * scaleY;
            
            // Convert pixel coordinates to hex coordinates
            const hexCoords = this.pixelToHex(mouseX, mouseY);
            
            if (hexCoords) {
                const cell = this.hive.getCell(hexCoords.q, hexCoords.r);
                
                if (cell) {
                    // Show tooltip with cell info
                    tooltip.innerHTML = this.getCellTooltipContent(cell);
                    tooltip.classList.add('visible');
                    
                    // Position tooltip near pointer (using screen coordinates, not canvas)
                    tooltip.style.left = (clientX + 15) + 'px';
                    tooltip.style.top = (clientY + 15) + 'px';
                    return;
                }
            }
            
            // Hide tooltip if not over a cell
            tooltip.classList.remove('visible');
        };
        
        // Mouse events
        canvas.addEventListener('mousemove', (e) => {
            handlePointerMove(e.clientX, e.clientY);
        });
        
        canvas.addEventListener('mouseleave', () => {
            tooltip.classList.remove('visible');
        });
        
        // Touch events
        canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) {
                const touch = e.touches[0];
                handlePointerMove(touch.clientX, touch.clientY);
            }
        }, { passive: true });
        
        canvas.addEventListener('touchend', () => {
            // Hide tooltip shortly after touch ends
            setTimeout(() => {
                tooltip.classList.remove('visible');
            }, 2000); // Keep visible for 2 seconds after touch
        }, { passive: true });
    }
    
    pixelToHex(pixelX, pixelY) {
        if (!this.renderer) return null;
        
        const hexSize = this.renderer.hexSize;
        const offsetX = this.renderer.offsetX;
        const offsetY = this.renderer.offsetY;
        
        // Adjust for canvas offset
        const x = pixelX - offsetX;
        const y = pixelY - offsetY;
        
        const hexWidth = hexSize * 2;
        const hexHeight = hexSize * Math.sqrt(3);
        
        // Proper pixel-to-hex conversion for offset coordinates
        // First, get approximate column
        const approxCol = Math.round(x / (hexWidth * 0.75));
        
        // Check nearby columns (current and adjacent)
        const cols = this.config.grid.columns;
        const rows = this.config.grid.rows;
        const candidates = [];
        
        for (let col = Math.max(0, approxCol - 1); col <= Math.min(cols - 1, approxCol + 1); col++) {
            // For each column, check possible rows
            const yOffset = (col % 2) * (hexHeight / 2);
            const approxRow = Math.round((y - yOffset) / hexHeight);
            
            for (let row = Math.max(0, approxRow - 1); row <= Math.min(rows - 1, approxRow + 1); row++) {
                // Calculate the center of this hex
                const hexX = col * hexWidth * 0.75;
                const hexY = row * hexHeight + (col % 2) * (hexHeight / 2);
                
                // Calculate distance from mouse to hex center
                const dx = x - hexX;
                const dy = y - hexY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // Check if point is actually inside the hexagon
                // Use a tighter bound based on hex geometry
                if (this.isPointInHex(dx, dy, hexSize)) {
                    candidates.push({ q: col, r: row, distance });
                }
            }
        }
        
        // Return the closest hex that actually contains the point
        if (candidates.length > 0) {
            candidates.sort((a, b) => a.distance - b.distance);
            return { q: candidates[0].q, r: candidates[0].r };
        }
        
        return null;
    }
    
    isPointInHex(dx, dy, hexSize) {
        // Check if a point (relative to hex center) is inside a pointy-top hexagon
        // The renderer draws hexagons with vertices at angles 0, π/3, 2π/3, π, 4π/3, 5π/3
        // This creates a pointy-top hexagon (vertices at top and bottom)
        
        const abs_dx = Math.abs(dx);
        const abs_dy = Math.abs(dy);
        
        // For a pointy-top hexagon with radius hexSize:
        // - Height: 2 * hexSize (vertices at ±hexSize in y direction)
        // - Width: √3 * hexSize (flat edges at ±√3/2 * hexSize in x direction)
        
        // Quick bounding box check
        if (abs_dy > hexSize) {
            return false; // Beyond top or bottom vertex
        }
        if (abs_dx > hexSize * Math.sqrt(3) / 2) {
            return false; // Beyond left or right flat edge
        }
        
        // Check against the angled edges
        // For a pointy-top hexagon, the angled edge constraint is:
        // |x|/√3 + |y| <= hexSize
        return abs_dx / Math.sqrt(3) + abs_dy <= hexSize;
    }
    
    getCellTooltipContent(cell) {
        const stateName = this.getCellStateName(cell.state);
        const beeCount = cell.occupyingBees ? cell.occupyingBees.length : 0;
        
        let html = `<div class="cell-tooltip-header">Cell (${cell.q}, ${cell.r})</div>`;
        html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">State:</span><span class="cell-tooltip-value">${stateName}</span></div>`;
        
        if (cell.contentAmount > 0) {
            html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">Amount:</span><span class="cell-tooltip-value">${cell.contentAmount.toFixed(1)}</span></div>`;
        }
        
        if (cell.developmentTime > 0) {
            const progress = ((cell.developmentTime / cell.maxDevelopmentTime) * 100).toFixed(0);
            html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">Progress:</span><span class="cell-tooltip-value">${progress}%</span></div>`;
        }
        
        if (beeCount > 0) {
            html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">Bees:</span><span class="cell-tooltip-value">${beeCount}</span></div>`;
            
            // Show bee types
            const queenCount = cell.occupyingBees.filter(b => b.type === 'queen').length;
            const workerCount = cell.occupyingBees.filter(b => b.type === 'worker').length;
            
            if (queenCount > 0) {
                html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">  Queen:</span><span class="cell-tooltip-value">${queenCount}</span></div>`;
            }
            if (workerCount > 0) {
                html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">  Workers:</span><span class="cell-tooltip-value">${workerCount}</span></div>`;
            }
        }
        
        if (cell.isDirty) {
            html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">Status:</span><span class="cell-tooltip-value">Dirty</span></div>`;
        }
        
        if (cell.hasDeadBee()) {
            const deadBeeText = cell.deadBeeCount > 1 ? `${cell.deadBeeCount} Dead Bees` : 'Dead Bee';
            html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">Status:</span><span class="cell-tooltip-value">${deadBeeText}</span></div>`;
        }
        
        return html;
    }
    
    getCellStateName(state) {
        const names = {
            'empty': 'Empty',
            'egg': 'Egg',
            'larvaeHungry': 'Larvae (Hungry)',
            'larvaeFed': 'Larvae (Fed)',
            'cappedBrood': 'Capped Brood',
            'nectar': 'Nectar',
            'honey': 'Honey',
            'honeyComplete': 'Honey (Full)',
            'honeyCapped': 'Capped Honey',
            'pollen': 'Pollen',
            'beeBread': 'Bee Bread',
            'water': 'Water'
        };
        return names[state] || state;
    }
    
    async loadConfig() {
        try {
            const response = await fetch('config.json');
            this.config = await response.json();
        } catch (error) {
            console.error('Failed to load config.json:', error);
            // Use default config if file doesn't exist
            this.config = this.getDefaultConfig();
        }
    }
    
    getDefaultConfig() {
        // Fallback default configuration
        return {
            grid: { columns: 10, rows: 7, hexSize: 40 },
            colors: {
                cellStates: {
                    empty: "#F5F5DC",
                    egg: "#FFFFFF",
                    larvaeHungry: "#FFE4B5",
                    larvaeFed: "#FFDAB9",
                    cappedBrood: "#D2691E",
                    nectar: "#87CEEB",
                    honey: "#FFD700",
                    honeyComplete: "#FFA500",
                    pollen: "#FFA500",
                    beeBread: "#FF8C00"
                },
                bees: {
                    queen: "#FF1493",
                    workerYoung: "#000000",
                    workerMiddle: "#333333",
                    workerOld: "#666666",
                    workerVeryOld: "#999999"
                },
                borders: { default: "#8B4513", highlight: "#FFB300" }
            },
            simulation: {
                startWithQueen: true,
                initialWorkerCount: 30,
                initialHoneyStores: 15,
                initialPollenStores: 10,
                tickRate: 100,
                queenEggLayingInterval: 20,
                queenFeedingInterval: 30,
                workerForagingDuration: 120,
                workerNurseDuration: 60,
                eggDuration: 3,
                larvaeDuration: 6,
                pupaDuration: 12,
                workerLifespan: 42,
                queenLifespan: 1460
            },
            environment: {
                basePollenRate: 1.0,
                seasonalMultipliers: { spring: 1.5, summer: 2.0, fall: 0.8, winter: 0.1 },
                hourlyActivityMultipliers: {
                    "0": 0.0, "1": 0.0, "2": 0.0, "3": 0.0, "4": 0.0, "5": 0.0,
                    "6": 0.2, "7": 0.5, "8": 0.8, "9": 1.0, "10": 1.2, "11": 1.3,
                    "12": 1.5, "13": 1.5, "14": 1.4, "15": 1.2, "16": 1.0, "17": 0.8,
                    "18": 0.5, "19": 0.2, "20": 0.0, "21": 0.0, "22": 0.0, "23": 0.0
                },
                randomnessRange: 0.2,
                darkModeStartHour: 19,
                darkModeEndHour: 7
            },
            ui: {
                showControls: true,
                showHUD: true,
                showLegend: true,
                defaultTimeMultiplier: 1,
                maxTimeMultiplier: 1000,
                useCurrentTime: true
            },
            advanced: {
                pathfindingEnabled: true,
                workerAgeColorVariation: true,
                agingSlowdownFactor: 0.02,
                foragerDeathChance: 0.01,
                maxBeesPerCell: 1,
                preferEmptyRoutes: true
            }
        };
    }
    
    setupUI() {
        // Show/hide UI elements based on config
        const controls = document.getElementById('controls');
        const hud = document.getElementById('hud');
        const legend = document.getElementById('legend');
        
        if (this.config.ui.showControls) {
            controls.classList.add('visible');
        }
        
        if (!this.config.ui.showHUD) {
            hud.style.display = 'none';
        }
        
        if (!this.config.ui.showLegend) {
            legend.style.display = 'none';
        }
        
        // Setup collapsible panels
        this.setupCollapsiblePanels();
        
        // Setup time multiplier slider
        const multiplierSlider = document.getElementById('time-multiplier');
        const multiplierValue = document.getElementById('multiplier-value');
        
        if (multiplierSlider) {
            multiplierSlider.max = this.config.ui.maxTimeMultiplier;
            multiplierSlider.value = this.config.ui.defaultTimeMultiplier;
            this.timeMultiplier = this.config.ui.defaultTimeMultiplier;
            
            multiplierSlider.addEventListener('input', (e) => {
                this.timeMultiplier = parseFloat(e.target.value);
                multiplierValue.textContent = this.timeMultiplier;
            });
        }
        
        // Setup start time picker
        const startTimePicker = document.getElementById('start-time');
        if (startTimePicker) {
            // Set to current time
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            
            startTimePicker.value = `${year}-${month}-${day}T${hours}:${minutes}`;
            
            startTimePicker.addEventListener('change', (e) => {
                const newDate = new Date(e.target.value);
                if (!isNaN(newDate.getTime())) {
                    // Show confirmation dialog
                    const confirmed = confirm(
                        '⚠️ WARNING: Changing the start time will reset the entire hive!\n\n' +
                        'All bees, brood, and stored resources will be lost.\n' +
                        'The simulation will restart from the beginning.\n\n' +
                        'Do you want to continue?'
                    );
                    
                    if (confirmed) {
                        this.resetSimulation(newDate);
                    } else {
                        // Revert the date picker to current simulation date
                        const currentYear = this.simulationDate.getFullYear();
                        const currentMonth = String(this.simulationDate.getMonth() + 1).padStart(2, '0');
                        const currentDay = String(this.simulationDate.getDate()).padStart(2, '0');
                        const currentHours = String(this.simulationDate.getHours()).padStart(2, '0');
                        const currentMinutes = String(this.simulationDate.getMinutes()).padStart(2, '0');
                        
                        startTimePicker.value = `${currentYear}-${currentMonth}-${currentDay}T${currentHours}:${currentMinutes}`;
                    }
                }
            });
        }
        
        // Update theme based on time
        this.updateTheme();
    }
    
    updateTheme() {
        const darkMode = isDarkMode(this.simulationDate, this.config);
        document.body.className = darkMode ? 'dark-mode' : 'light-mode';
    }
    
    resetSimulation(newStartDate) {
        // Reset simulation time
        this.elapsedSimulationTime = 0;
        this.simulationDate = newStartDate;
        
        // Recreate the hive from scratch
        this.hive = new Hive(this.config);
        
        // Update theme for new time
        this.updateTheme();
        
        // Force immediate render
        this.renderer.render(this.hive);
        this.updateHUD();
    }
    
    gameLoop(timestamp) {
        if (!this.running) return;
        
        const deltaTime = (timestamp - this.lastTimestamp) / 1000; // Convert to seconds
        this.lastTimestamp = timestamp;
        
        // Update simulation time
        // deltaTime is in seconds, timeMultiplier accelerates time
        const simulationDelta = deltaTime * this.timeMultiplier;
        
        // Track total elapsed simulation time
        this.elapsedSimulationTime += simulationDelta;
        
        // In our simulation, durations in config are in "days"
        // 1 simulation day = 1 day of real time at 1x multiplier
        // We need to convert real seconds to simulation time
        // At 1x: 1 real second = 1 simulation second
        // Convert simulation seconds to milliseconds for date
        const simulationMilliseconds = simulationDelta * 1000;
        this.simulationDate = new Date(this.simulationDate.getTime() + simulationMilliseconds);
        
        // Update hive
        this.hive.update(simulationDelta, this.simulationDate);
        
        // Render
        this.renderer.render(this.hive);
        
        // Update HUD
        this.updateHUD();
        
        // Update theme
        this.updateTheme();
        
        // Continue loop
        requestAnimationFrame((t) => this.gameLoop(t));
    }
    
    updateHUD() {
        const stats = this.hive.getStats();
        const season = getSeason(this.simulationDate);
        
        // Format elapsed simulation time
        const totalSeconds = Math.floor(this.elapsedSimulationTime);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        let simTimeStr = '';
        if (days > 0) {
            simTimeStr = `${days}d ${hours}h ${minutes}m`;
        } else if (hours > 0) {
            simTimeStr = `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
            simTimeStr = `${minutes}m ${seconds}s`;
        } else {
            simTimeStr = `${seconds}s`;
        }
        
        document.getElementById('stat-population').textContent = stats.population;
        document.getElementById('stat-brood').textContent = stats.brood;
        document.getElementById('stat-honey').textContent = stats.honey;
        document.getElementById('stat-pollen').textContent = stats.pollen;
        document.getElementById('stat-water').textContent = stats.water;
        document.getElementById('stat-inside').textContent = stats.beesInside;
        document.getElementById('stat-outside').textContent = stats.beesOutside;
        document.getElementById('stat-foraging-rate').textContent = stats.foragingRate;
        document.getElementById('stat-sim-time').textContent = simTimeStr;
        document.getElementById('stat-time').textContent = formatTime(this.simulationDate);
        document.getElementById('stat-date').textContent = formatDate(this.simulationDate);
        document.getElementById('stat-season').textContent = season.charAt(0).toUpperCase() + season.slice(1);
        
        // Queen stats
        if (stats.queenAge > 0) {
            const queenAgeDays = Math.floor(stats.queenAge / 86400);
            const queenLifespanDays = Math.floor(stats.queenMaxAge / 86400);
            const queenLifespanPercent = ((stats.queenAge / stats.queenMaxAge) * 100).toFixed(1);
            
            document.getElementById('stat-queen-age').textContent = `${queenAgeDays} days`;
            document.getElementById('stat-queen-lifespan').textContent = `${queenLifespanPercent}% (${queenLifespanDays} days total)`;
            document.getElementById('stat-queen-eggs-total').textContent = stats.queenEggsTotal;
            document.getElementById('stat-queen-eggs-hour').textContent = stats.queenEggsHour;
            document.getElementById('stat-queen-task').textContent = stats.queenTask;
        } else {
            document.getElementById('stat-queen-age').textContent = 'No Queen';
            document.getElementById('stat-queen-lifespan').textContent = '---';
            document.getElementById('stat-queen-eggs-total').textContent = '---';
            document.getElementById('stat-queen-eggs-hour').textContent = '---';
            document.getElementById('stat-queen-task').textContent = '---';
        }
    }
}

// Start the simulator when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new BeeHiveSimulator();
});

