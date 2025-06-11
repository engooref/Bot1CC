// src/utils/JSONConfigManager.ts
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import logger from '../logger.js';

export class JSONConfigManager<T extends Record<string, any>> extends EventEmitter {
  private filePath: string | null;
  private data: Partial<T> = {};
  private isWatching = false;

  constructor(filePath: string);
  constructor(jsonString: string, isString: true);
  // Implémentation unique
  constructor(input: string, isString = false) {
    super();
    if (isString) {
      // On reçoit directement la chaîne JSON
      try {
        this.data = JSON.parse(input) as Partial<T>;
      } catch (err) {
        throw new Error(`Invalid JSON string: ${(err as Error).message}`);
      }
      this.filePath = null;
    } else {
      // On reçoit un chemin de fichier
      this.filePath = path.resolve(input);
      this.loadFromDisk();
    }
  }

  public getAll(): T {
    return this.data as T;
  }

  public async add<K extends keyof T>(key: K, value: T[K]): Promise<void> {
    this.data[key] = value;
    await this.save();
    this.emit('change', this.getAll());
  }

  public get<K extends keyof T>(key: K): T[K] | undefined {
    return this.data[key] as T[K] | undefined;
  }

  public async remove<K extends keyof T>(key: K): Promise<void> {
    delete this.data[key];
    await this.save();
    this.emit('change', this.getAll());
  }

  public watch(interval = 1000): void {
    if (this.isWatching) return;
    this.isWatching = true;
    fs.watchFile(this.filePath!, { interval }, () => {
      this.loadFromDisk();
      this.emit('change', this.getAll());
      
    });
  }

  private loadFromDisk() {
    try {
      const raw = fs.readFileSync(this.filePath!, 'utf-8');
      this.data = JSON.parse(raw);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        fs.writeFileSync(this.filePath!, '{}', 'utf-8');
        this.data = {};
      } else {
        logger.error(err);
      }
    }
  }

  private async save() {
    if(!this.filePath) return
    const tmp = this.filePath + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
    await fs.promises.rename(tmp, this.filePath);
  }

  public async copy(json: JSONConfigManager<T>) 
  {
    this.data = json.data
    await this.save();
  }
}
