// src/utils/JSONConfigManager.ts
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import logger from '../logger.js';

export class JSONConfigManager<T extends Record<string, any>> extends EventEmitter {
  private filePath: string;
  private data: Partial<T> = {};
  private isWatching = false;

  constructor(filePath: string) {
    super();
    this.filePath = path.resolve(filePath);
    this.loadFromDisk();
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
    fs.watchFile(this.filePath, { interval }, () => {
      this.loadFromDisk();
      this.emit('change', this.getAll());
    });
  }

  private loadFromDisk() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      this.data = JSON.parse(raw);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        fs.writeFileSync(this.filePath, '{}', 'utf-8');
        this.data = {};
      } else {
        logger.error(err);
      }
    }
  }

  private async save() {
    const tmp = this.filePath + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
    await fs.promises.rename(tmp, this.filePath);
  }
}
