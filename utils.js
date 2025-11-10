// Utility functions for the bee hive simulator

export function hexToPixel(col, row, hexSize) {
    // Convert offset grid coordinates (col, row) to pixel position
    // Using flat-topped hexagons with offset rows
    const hexWidth = hexSize * 2;
    const hexHeight = hexSize * Math.sqrt(3);
    
    const x = col * hexWidth * 0.75;
    const y = row * hexHeight + (col % 2) * (hexHeight / 2);
    
    return { x, y };
}

export function pixelToHex(x, y, hexSize) {
    const q = (2/3 * x) / hexSize;
    const r = (-1/3 * x + Math.sqrt(3)/3 * y) / hexSize;
    return axialRound(q, r);
}

function axialRound(q, r) {
    const s = -q - r;
    let rq = Math.round(q);
    let rr = Math.round(r);
    let rs = Math.round(s);
    
    const qDiff = Math.abs(rq - q);
    const rDiff = Math.abs(rr - r);
    const sDiff = Math.abs(rs - s);
    
    if (qDiff > rDiff && qDiff > sDiff) {
        rq = -rr - rs;
    } else if (rDiff > sDiff) {
        rr = -rq - rs;
    }
    
    return { q: rq, r: rr };
}

export function getHexNeighbors(col, row) {
    // Get neighbors for offset coordinate hexagonal grid
    // The neighbors depend on whether the column is even or odd
    const isEvenCol = col % 2 === 0;
    
    if (isEvenCol) {
        return [
            { q: col + 1, r: row },       // right
            { q: col + 1, r: row - 1 },   // top-right
            { q: col, r: row - 1 },       // top-left
            { q: col - 1, r: row - 1 },   // left-top
            { q: col - 1, r: row },       // left
            { q: col, r: row + 1 }        // bottom
        ];
    } else {
        return [
            { q: col + 1, r: row + 1 },   // right-bottom
            { q: col + 1, r: row },       // right
            { q: col, r: row - 1 },       // top
            { q: col - 1, r: row },       // left
            { q: col - 1, r: row + 1 },   // left-bottom
            { q: col, r: row + 1 }        // bottom
        ];
    }
}

export function getSeason(date) {
    const month = date.getMonth();
    if (month >= 2 && month <= 4) return 'spring';
    if (month >= 5 && month <= 7) return 'summer';
    if (month >= 8 && month <= 10) return 'fall';
    return 'winter';
}

export function getTimeOfDay(date) {
    const hour = date.getHours();
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    if (hour >= 18 && hour < 22) return 'evening';
    return 'night';
}

export function isDarkMode(date, config) {
    const hour = date.getHours();
    const startHour = config.environment.darkModeStartHour;
    const endHour = config.environment.darkModeEndHour;
    
    if (startHour > endHour) {
        return hour >= startHour || hour < endHour;
    }
    return hour >= startHour && hour < endHour;
}

export function getActivityMultiplier(date, config) {
    const hour = date.getHours();
    const season = getSeason(date);
    
    const hourlyMultiplier = config.environment.hourlyActivityMultipliers[hour.toString()] || 0;
    const seasonalMultiplier = config.environment.seasonalMultipliers[season] || 1;
    const randomness = config.environment.randomnessRange;
    const randomFactor = 1 + (Math.random() * randomness * 2 - randomness);
    
    return hourlyMultiplier * seasonalMultiplier * randomFactor;
}

export function distance(q1, r1, q2, r2) {
    return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

export function lerp(a, b, t) {
    return a + (b - a) * t;
}

export function lerpColor(color1, color2, t) {
    const c1 = hexToRgb(color1);
    const c2 = hexToRgb(color2);
    
    const r = Math.round(lerp(c1.r, c2.r, t));
    const g = Math.round(lerp(c1.g, c2.g, t));
    const b = Math.round(lerp(c1.b, c2.b, t));
    
    return rgbToHex(r, g, b);
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export class PriorityQueue {
    constructor() {
        this.items = [];
    }
    
    enqueue(element, priority) {
        const queueElement = { element, priority };
        let added = false;
        
        for (let i = 0; i < this.items.length; i++) {
            if (queueElement.priority < this.items[i].priority) {
                this.items.splice(i, 0, queueElement);
                added = true;
                break;
            }
        }
        
        if (!added) {
            this.items.push(queueElement);
        }
    }
    
    dequeue() {
        return this.items.shift();
    }
    
    isEmpty() {
        return this.items.length === 0;
    }
}

