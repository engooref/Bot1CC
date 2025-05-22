var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/Event.ts
import { Entity, PrimaryKey, Property, ManyToOne, ManyToMany, OneToMany, Collection, } from '@mikro-orm/core';
import { EventType } from './EventType.js';
import { Response } from './Response.js';
import { User } from './User.js';
let Event = class Event {
    constructor(init) {
        this.name = '';
        this.object1Cc = '';
        this.objectAdv = '';
        this.commentaire = '';
        this.spawn = '';
        this.lieuEvent = '';
        this.picture = '';
        this.nbResp = '';
        this.regleVehicule = {};
        this.regleEnga = {};
        this.regleQui = {};
        this.isValid = false;
        this.respawn = '';
        this.briefingFileName = '';
        this.description = '';
        this.appelMsgDiscord = false;
        this.briefingTemplateName = '';
        this.roleDispo = '';
        this.responses = new Collection(this);
        this.users = new Collection(this);
        if (init) {
            Object.assign(this, init);
            if (Array.isArray(init.responses)) {
                this.responses = new Collection(this, init.responses);
            }
            if (Array.isArray(init.users)) {
                this.users = new Collection(this, init.users);
            }
        }
    }
    get startDate() {
        const d = this.start;
        return d
            ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
            : '';
    }
    get startTime() {
        const d = this.start;
        return d
            ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
            : '';
    }
    toString() {
        return this.name;
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], Event.prototype, "id", void 0);
__decorate([
    Property({ type: 'bigint', nullable: true }),
    __metadata("design:type", String)
], Event.prototype, "discordId", void 0);
__decorate([
    Property({ type: 'datetime' }),
    __metadata("design:type", Date)
], Event.prototype, "start", void 0);
__decorate([
    Property({ type: 'time' }),
    __metadata("design:type", String)
], Event.prototype, "lancServ", void 0);
__decorate([
    Property({ type: 'time' }),
    __metadata("design:type", String)
], Event.prototype, "lancScen", void 0);
__decorate([
    Property({ type: 'datetime' }),
    __metadata("design:type", String)
], Event.prototype, "end", void 0);
__decorate([
    Property({ length: 255, default: '' }),
    __metadata("design:type", String)
], Event.prototype, "name", void 0);
__decorate([
    ManyToOne(() => EventType, { nullable: true }),
    __metadata("design:type", EventType)
], Event.prototype, "type", void 0);
__decorate([
    Property({ type: 'text', fieldName: 'object1_cc', default: '' }),
    __metadata("design:type", String)
], Event.prototype, "object1Cc", void 0);
__decorate([
    Property({ type: 'text', default: '' }),
    __metadata("design:type", String)
], Event.prototype, "objectAdv", void 0);
__decorate([
    Property({ type: 'text', default: '' }),
    __metadata("design:type", String)
], Event.prototype, "commentaire", void 0);
__decorate([
    Property({ length: 255, default: '' }),
    __metadata("design:type", String)
], Event.prototype, "spawn", void 0);
__decorate([
    Property({ length: 255, default: '' }),
    __metadata("design:type", String)
], Event.prototype, "lieuEvent", void 0);
__decorate([
    Property({ length: 255, nullable: true, default: '' }),
    __metadata("design:type", String)
], Event.prototype, "picture", void 0);
__decorate([
    Property({ length: 255, default: '' }),
    __metadata("design:type", String)
], Event.prototype, "nbResp", void 0);
__decorate([
    Property({ type: 'json', default: '{}' }),
    __metadata("design:type", Object)
], Event.prototype, "regleVehicule", void 0);
__decorate([
    Property({ type: 'json', default: '{}' }),
    __metadata("design:type", Object)
], Event.prototype, "regleEnga", void 0);
__decorate([
    Property({ type: 'json', default: '{}' }),
    __metadata("design:type", Object)
], Event.prototype, "regleQui", void 0);
__decorate([
    Property({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], Event.prototype, "isValid", void 0);
__decorate([
    Property({ length: 255, default: '' }),
    __metadata("design:type", String)
], Event.prototype, "respawn", void 0);
__decorate([
    Property({ type: 'bigint', nullable: true }),
    __metadata("design:type", String)
], Event.prototype, "briefingDiscordId", void 0);
__decorate([
    Property({ length: 255, nullable: true, default: '' }),
    __metadata("design:type", String)
], Event.prototype, "briefingFileName", void 0);
__decorate([
    Property({ type: 'bigint', nullable: true }),
    __metadata("design:type", String)
], Event.prototype, "attributionDiscordId", void 0);
__decorate([
    Property({ type: 'text', nullable: true, default: '' }),
    __metadata("design:type", String)
], Event.prototype, "description", void 0);
__decorate([
    Property({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], Event.prototype, "appelMsgDiscord", void 0);
__decorate([
    Property({ length: 255, nullable: true, default: '' }),
    __metadata("design:type", String)
], Event.prototype, "briefingTemplateName", void 0);
__decorate([
    Property({ length: 255, default: '' }),
    __metadata("design:type", String)
], Event.prototype, "roleDispo", void 0);
__decorate([
    OneToMany(() => Response, resp => resp.event, { orphanRemoval: true }),
    __metadata("design:type", Object)
], Event.prototype, "responses", void 0);
__decorate([
    ManyToMany(() => User, user => user.events, { owner: true, pivotTable: 'event_user' }),
    __metadata("design:type", Object)
], Event.prototype, "users", void 0);
__decorate([
    ManyToOne(() => User, { nullable: false }),
    __metadata("design:type", Object)
], Event.prototype, "userOrig", void 0);
Event = __decorate([
    Entity({ tableName: 'event' }),
    __metadata("design:paramtypes", [Object])
], Event);
export { Event };
//# sourceMappingURL=Event.js.map