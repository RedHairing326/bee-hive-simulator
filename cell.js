// Cell class representing each hexagonal cell in the hive

export const CellState = {
    EMPTY: 'empty',
    EGG: 'egg',
    LARVAE_HUNGRY: 'larvaeHungry',
    LARVAE_FED: 'larvaeFed',
    CAPPED_BROOD: 'cappedBrood',
    NECTAR: 'nectar',
    HONEY: 'honey',
    HONEY_COMPLETE: 'honeyComplete',
    HONEY_CAPPED: 'honeyCapped',
    POLLEN: 'pollen',
    BEE_BREAD: 'beeBread',
    WATER: 'water'
};

export class Cell {
    constructor(q, r, config) {
        this.q = q;
        this.r = r;
        this.state = CellState.EMPTY;
        this.occupyingBees = []; // Array of bees in this cell
        this.developmentTime = 0;
        this.maxDevelopmentTime = 0;
        this.contentAmount = 0; // For nectar, honey, pollen
        this.config = config;
        this.isDirty = false; // Needs cleaning before use
        this.deadBeeCount = 0; // Number of dead bees in this cell
    }
    
    isEmpty() {
        return this.state === CellState.EMPTY;
    }
    
    isOccupied() {
        return this.occupyingBees.length > 0;
    }
    
    canBeOccupied() {
        const maxBees = this.config.advanced.maxBeesPerCell || 9;
        return this.occupyingBees.length < maxBees;
    }
    
    isFull() {
        const maxBees = this.config.advanced.maxBeesPerCell || 9;
        return this.occupyingBees.length >= maxBees;
    }
    
    isBrood() {
        return this.state === CellState.EGG || 
               this.state === CellState.LARVAE_HUNGRY ||
               this.state === CellState.LARVAE_FED ||
               this.state === CellState.CAPPED_BROOD;
    }
    
    isFood() {
        return this.state === CellState.NECTAR ||
               this.state === CellState.HONEY ||
               this.state === CellState.HONEY_COMPLETE ||
               this.state === CellState.HONEY_CAPPED ||
               this.state === CellState.POLLEN ||
               this.state === CellState.BEE_BREAD ||
               this.state === CellState.WATER;
    }
    
    setEgg() {
        if (this.isEmpty() && this.deadBeeCount === 0 && !this.isDirty) {
            this.state = CellState.EGG;
            this.developmentTime = 0;
            this.maxDevelopmentTime = this.config.simulation.eggDuration;
            return true;
        }
        return false;
    }
    
    hasDeadBee() {
        return this.deadBeeCount > 0;
    }
    
    addDeadBee() {
        this.deadBeeCount++;
    }
    
    addNectar(amount = 1) {
        if (this.isEmpty()) {
            this.state = CellState.NECTAR;
            this.contentAmount = amount;
            return true;
        } else if (this.state === CellState.NECTAR && this.contentAmount < 10) {
            this.contentAmount = Math.min(10, this.contentAmount + amount);
            return true;
        }
        return false;
    }
    
    addPollen(amount = 1) {
        if (this.isEmpty()) {
            this.state = CellState.POLLEN;
            this.contentAmount = amount;
            return true;
        } else if (this.state === CellState.POLLEN && this.contentAmount < 10) {
            this.contentAmount = Math.min(10, this.contentAmount + amount);
            return true;
        }
        return false;
    }
    
    consumeHoney(amount = 1) {
        if (this.state === CellState.HONEY || this.state === CellState.HONEY_COMPLETE) {
            this.contentAmount -= amount;
            if (this.contentAmount <= 0) {
                this.state = CellState.EMPTY;
                this.contentAmount = 0;
            }
            return true;
        }
        return false;
    }
    
    consumePollen(amount = 1) {
        if (this.state === CellState.POLLEN || this.state === CellState.BEE_BREAD) {
            this.contentAmount -= amount;
            if (this.contentAmount <= 0) {
                this.state = CellState.EMPTY;
                this.contentAmount = 0;
            }
            return true;
        }
        return false;
    }
    
    addWater(amount = 1) {
        if (this.isEmpty()) {
            this.state = CellState.WATER;
            this.contentAmount = amount;
            return true;
        } else if (this.state === CellState.WATER && this.contentAmount < 5) {
            this.contentAmount = Math.min(5, this.contentAmount + amount);
            return true;
        }
        return false;
    }
    
    consumeWater(amount = 1) {
        if (this.state === CellState.WATER) {
            this.contentAmount -= amount;
            if (this.contentAmount <= 0) {
                this.state = CellState.EMPTY;
                this.contentAmount = 0;
            }
            return true;
        }
        return false;
    }
    
    clean() {
        if (this.isEmpty() && this.isDirty) {
            this.isDirty = false;
            return true;
        }
        return false;
    }
    
    capHoney() {
        if (this.state === CellState.HONEY_COMPLETE) {
            this.state = CellState.HONEY_CAPPED;
            return true;
        }
        return false;
    }
    
    removeDeadBee() {
        if (this.deadBeeCount > 0) {
            this.deadBeeCount--;
            return true;
        }
        return false;
    }
    
    update(deltaTime) {
        if (this.isBrood()) {
            // LARVAE_HUNGRY progress slowly while waiting to be fed
            // Once fed, they progress normally as LARVAE_FED
            if (this.state === CellState.LARVAE_HUNGRY) {
                // Hungry larvae still develop, just slower (50% speed)
                this.developmentTime += deltaTime * 0.5;
            } else {
                // Eggs, fed larvae, and capped brood develop normally
                this.developmentTime += deltaTime;
            }
            
            if (this.developmentTime >= this.maxDevelopmentTime) {
                this.developmentTime = 0;
                
                switch (this.state) {
                    case CellState.EGG:
                        this.state = CellState.LARVAE_HUNGRY;
                        this.maxDevelopmentTime = this.config.simulation.larvaeDuration;
                        break;
                    case CellState.LARVAE_HUNGRY:
                        // Hungry larvae can still progress if not fed (less healthy)
                        // But normally should be fed to become LARVAE_FED first
                        this.state = CellState.CAPPED_BROOD;
                        this.maxDevelopmentTime = this.config.simulation.pupaDuration;
                        break;
                    case CellState.LARVAE_FED:
                        this.state = CellState.CAPPED_BROOD;
                        this.maxDevelopmentTime = this.config.simulation.pupaDuration;
                        break;
                    case CellState.CAPPED_BROOD:
                        // Bee emerges - handled by hive
                        return 'emerge';
                }
            }
        } else if (this.state === CellState.NECTAR) {
            // Slowly convert nectar to honey
            if (Math.random() < 0.01) {
                this.state = CellState.HONEY;
            }
        } else if (this.state === CellState.HONEY && this.contentAmount >= 8) {
            this.state = CellState.HONEY_COMPLETE;
        } else if (this.state === CellState.POLLEN && Math.random() < 0.005) {
            // Convert pollen to bee bread
            this.state = CellState.BEE_BREAD;
            this.contentAmount = Math.floor(this.contentAmount * this.config.simulation.pollenToBeeBreadConversion);
        }
        
        // Slowly consume excess food stores (bees eat it)
        if (this.isFood() && this.contentAmount > 0) {
            // Consume food at a steady rate (bees eat it over time)
            // Very low rate to balance with improved foraging
            // Water evaporates faster than food is consumed
            const consumptionRate = this.state === CellState.WATER ? 0.001 : 0.00005;
            if (Math.random() < consumptionRate * deltaTime) {
                this.contentAmount -= 0.2;
                if (this.contentAmount <= 0) {
                    this.state = CellState.EMPTY;
                    this.contentAmount = 0;
                    // Cells become dirty after use (chance)
                    if (Math.random() < 0.3) {
                        this.isDirty = true;
                    }
                }
            }
        }
        
        return null;
    }
    
    feedLarvae() {
        if (this.state === CellState.LARVAE_HUNGRY) {
            this.state = CellState.LARVAE_FED;
            return true;
        }
        return false;
    }
    
    getColor() {
        return this.config.colors.cellStates[this.state] || '#CCCCCC';
    }
    
    getDevelopmentProgress() {
        if (this.maxDevelopmentTime > 0) {
            return this.developmentTime / this.maxDevelopmentTime;
        }
        return 0;
    }
}

