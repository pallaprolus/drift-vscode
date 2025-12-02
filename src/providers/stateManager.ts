import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DocCodePair, DocCodePairState, DriftState } from '../models/types';
import { hashContent } from '../utils/helpers';

const STATE_VERSION = '1.0.0';
const STATE_DIR = '.drift';
const STATE_FILE = 'state.json';

/**
 * Manages persistent drift state in .drift/state.json
 * This allows teams to commit reviewed state to Git
 */
export class StateManager {
    private state: DriftState;
    private stateFilePath: string | null = null;
    private isDirty = false;
    
    constructor() {
        this.state = {
            version: STATE_VERSION,
            pairs: new Map()
        };
    }
    
    /**
     * Initialize state manager for a workspace
     */
    async initialize(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }
        
        const rootPath = workspaceFolders[0].uri.fsPath;
        const stateDir = path.join(rootPath, STATE_DIR);
        this.stateFilePath = path.join(stateDir, STATE_FILE);
        
        // Load existing state if it exists
        await this.loadState();
    }
    
    /**
     * Load state from disk
     */
    private async loadState(): Promise<void> {
        if (!this.stateFilePath) return;
        
        try {
            if (fs.existsSync(this.stateFilePath)) {
                const content = fs.readFileSync(this.stateFilePath, 'utf-8');
                const data = JSON.parse(content);
                
                // Convert pairs object back to Map
                this.state = {
                    version: data.version || STATE_VERSION,
                    pairs: new Map(Object.entries(data.pairs || {})),
                    lastFullScan: data.lastFullScan ? new Date(data.lastFullScan) : undefined
                };
            }
        } catch (error) {
            console.error('Error loading drift state:', error);
            // Start with fresh state if file is corrupted
            this.state = {
                version: STATE_VERSION,
                pairs: new Map()
            };
        }
    }
    
    /**
     * Save state to disk
     */
    async saveState(): Promise<void> {
        if (!this.stateFilePath) return;
        
        try {
            const stateDir = path.dirname(this.stateFilePath);
            
            // Create .drift directory if it doesn't exist
            if (!fs.existsSync(stateDir)) {
                fs.mkdirSync(stateDir, { recursive: true });
                
                // Create .gitignore to optionally ignore state file
                const gitignorePath = path.join(stateDir, '.gitignore');
                if (!fs.existsSync(gitignorePath)) {
                    fs.writeFileSync(gitignorePath, 
                        '# Uncomment the line below to ignore drift state\n' +
                        '# state.json\n'
                    );
                }
            }
            
            // Convert Map to object for JSON serialization
            const data = {
                version: this.state.version,
                pairs: Object.fromEntries(this.state.pairs),
                lastFullScan: this.state.lastFullScan?.toISOString()
            };
            
            fs.writeFileSync(this.stateFilePath, JSON.stringify(data, null, 2));
            this.isDirty = false;
        } catch (error) {
            console.error('Error saving drift state:', error);
            vscode.window.showErrorMessage('Failed to save drift state');
        }
    }
    
    /**
     * Get state for a specific pair
     */
    getPairState(pairId: string): DocCodePairState | undefined {
        return this.state.pairs.get(pairId);
    }
    
    /**
     * Update state for a pair (mark as reviewed/synced)
     */
    updatePairState(pair: DocCodePair): void {
        const pairState: DocCodePairState = {
            id: pair.id,
            filePath: pair.filePath,
            codeHash: pair.codeSignature.hash,
            docHash: hashContent(pair.docContent),
            isReviewed: pair.isReviewed,
            reviewedAt: pair.reviewedAt,
            driftScore: pair.driftScore
        };
        
        this.state.pairs.set(pair.id, pairState);
        this.isDirty = true;
    }
    
    /**
     * Mark a pair as reviewed (synced) with current code
     */
    markAsReviewed(pair: DocCodePair): void {
        pair.isReviewed = true;
        pair.reviewedAt = new Date();
        this.updatePairState(pair);
    }
    
    /**
     * Check if code has changed since last review
     */
    hasCodeChanged(pair: DocCodePair): boolean {
        const savedState = this.state.pairs.get(pair.id);
        if (!savedState) {
            return false; // Untracked, not "changed"
        }
        return savedState.codeHash !== pair.codeSignature.hash;
    }
    
    /**
     * Check if a pair is tracked
     */
    isTracked(pairId: string): boolean {
        return this.state.pairs.has(pairId);
    }
    
    /**
     * Get tracking status for a pair
     */
    getTrackingStatus(pair: DocCodePair): 'synced' | 'drifted' | 'untracked' {
        const savedState = this.state.pairs.get(pair.id);
        
        if (!savedState) {
            return 'untracked';
        }
        
        if (savedState.codeHash === pair.codeSignature.hash) {
            return 'synced';
        }
        
        return 'drifted';
    }
    
    /**
     * Remove state for a pair
     */
    removePairState(pairId: string): void {
        this.state.pairs.delete(pairId);
        this.isDirty = true;
    }
    
    /**
     * Clear all state
     */
    clearAllState(): void {
        this.state.pairs.clear();
        this.isDirty = true;
    }
    
    /**
     * Set last full scan time
     */
    setLastFullScan(date: Date): void {
        this.state.lastFullScan = date;
        this.isDirty = true;
    }
    
    /**
     * Get last full scan time
     */
    getLastFullScan(): Date | undefined {
        return this.state.lastFullScan;
    }
    
    /**
     * Check if there are unsaved changes
     */
    hasPendingChanges(): boolean {
        return this.isDirty;
    }
    
    /**
     * Get all tracked pairs
     */
    getAllTrackedPairs(): DocCodePairState[] {
        return Array.from(this.state.pairs.values());
    }
    
    /**
     * Get statistics
     */
    getStatistics(): { tracked: number; synced: number; drifted: number } {
        let synced = 0;
        let drifted = 0;
        
        for (const state of this.state.pairs.values()) {
            if (state.isReviewed) {
                synced++;
            } else {
                drifted++;
            }
        }
        
        return {
            tracked: this.state.pairs.size,
            synced,
            drifted
        };
    }
}
