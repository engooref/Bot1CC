var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/EventType.ts
import { Entity, PrimaryKey, Property, OneToMany, Collection } from '@mikro-orm/core';
import { Event } from './Event.js';
let EventType = class EventType {
    constructor(name, color) {
        /**
         * One-to-Many vers Event
         * mappedBy via la propriété `type` de Event
         */
        this.events = new Collection(this);
        this.name = name;
        this.color = color;
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], EventType.prototype, "id", void 0);
__decorate([
    Property({ length: 255 }),
    __metadata("design:type", String)
], EventType.prototype, "name", void 0);
__decorate([
    Property({ length: 7 }),
    __metadata("design:type", String)
], EventType.prototype, "color", void 0);
__decorate([
    OneToMany(() => Event, ev => ev.type),
    __metadata("design:type", Object)
], EventType.prototype, "events", void 0);
EventType = __decorate([
    Entity({ tableName: 'event_type' }),
    __metadata("design:paramtypes", [String, String])
], EventType);
export { EventType };
//# sourceMappingURL=EventType.js.map