var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/User.ts
import { Entity, PrimaryKey, Property, ManyToMany, OneToOne, Collection, } from '@mikro-orm/core';
import { Role } from './Role.js';
import { Event } from './Event.js';
import { RHMember } from './RHMember.js';
let User = class User {
    constructor(username, discordId, avatar, rolesDiscord = [], expPour = 0, expLevel = 0) {
        // Si tu veux stocker un JSON brut, nomme-le pour éviter conflit
        this.rolesJson = [];
        this.expPourcentage = 0;
        this.expLevel = 0;
        this.rolesDiscord = new Collection(this);
        this.events = new Collection(this);
        this.username = username;
        this.discordId = String(discordId);
        this.avatar = avatar;
        this.rolesDiscord = new Collection(this, rolesDiscord);
        this.expPourcentage = expPour;
        this.expLevel = expLevel;
    }
    reset() {
        this.rolesJson = [];
        this.avatar = '';
        this.expPourcentage = 0;
        this.expLevel = 0;
        this.rolesDiscord.removeAll();
        this.username = this.username.replace(/\[[^\]]*\]/g, '');
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], User.prototype, "id", void 0);
__decorate([
    Property({ type: 'json', fieldName: 'roles' }),
    __metadata("design:type", Object)
], User.prototype, "rolesJson", void 0);
__decorate([
    Property({ length: 255 }),
    __metadata("design:type", String)
], User.prototype, "username", void 0);
__decorate([
    Property({ type: 'bigint', unique: true, fieldName: 'discord_id' }),
    __metadata("design:type", String)
], User.prototype, "discordId", void 0);
__decorate([
    Property({ length: 255 }),
    __metadata("design:type", String)
], User.prototype, "avatar", void 0);
__decorate([
    Property({ defaultRaw: '0' }),
    __metadata("design:type", Number)
], User.prototype, "expPourcentage", void 0);
__decorate([
    Property({ defaultRaw: '0' }),
    __metadata("design:type", Number)
], User.prototype, "expLevel", void 0);
__decorate([
    ManyToMany(() => Role, role => role.users, {
        owner: true,
        pivotTable: 'user_role',
    }),
    __metadata("design:type", Object)
], User.prototype, "rolesDiscord", void 0);
__decorate([
    ManyToMany(() => Event, ev => ev.users),
    __metadata("design:type", Object)
], User.prototype, "events", void 0);
__decorate([
    OneToOne(() => RHMember, // callback pour reporter la résolution
    // callback pour reporter la résolution
    rh => rh.user, // lien inverse côté RHMember.user
    { nullable: true, orphanRemoval: true }),
    __metadata("design:type", Object)
], User.prototype, "rhProfile", void 0);
User = __decorate([
    Entity({ tableName: 'user' }),
    __metadata("design:paramtypes", [String, Object, String, Array, Object, Object])
], User);
export { User };
//# sourceMappingURL=User.js.map