var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var Role_1;
// src/entities/Role.ts
import { Entity, PrimaryKey, Property, OneToMany, ManyToMany, Collection, } from '@mikro-orm/core';
import { RHMember } from './RHMember.js';
import { Parameter } from './Parameter.js';
import { User } from './User.js';
let Role = Role_1 = class Role {
    /**
     * @param name       Nom du rôle
     * @param discordId  ID Discord (string ou number)
     * @param isGrade    Indique s’il s’agit d’un grade RH
     */
    constructor(name, discordId, isGrade = false) {
        this.isGrade = false;
        /** Profils RH liés (One-To-Many) */
        this.rHMembers = new Collection(this);
        /** Paramètres associés (Many-To-Many) */
        this.parameters = new Collection(this);
        /** Utilisateurs liés (Many-To-Many) */
        this.users = new Collection(this);
        this.name = name;
        this.discordId = String(discordId);
        this.isGrade = isGrade;
    }
    /** Comparaison basée sur l’ID Discord */
    equals(other) {
        return other instanceof Role_1 && other.discordId === this.discordId;
    }
    /** Hash simplifié pour collections ou maps */
    hash() {
        return this.discordId;
    }
    toString() {
        return this.name;
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], Role.prototype, "id", void 0);
__decorate([
    Property({ type: 'bigint', fieldName: 'discord_id' }),
    __metadata("design:type", String)
], Role.prototype, "discordId", void 0);
__decorate([
    Property({ length: 255 }),
    __metadata("design:type", String)
], Role.prototype, "name", void 0);
__decorate([
    Property({ type: 'boolean' }),
    __metadata("design:type", Boolean)
], Role.prototype, "isGrade", void 0);
__decorate([
    OneToMany(() => RHMember, rh => rh.grade),
    __metadata("design:type", Object)
], Role.prototype, "rHMembers", void 0);
__decorate([
    ManyToMany(() => Parameter, parameter => parameter.roles),
    __metadata("design:type", Object)
], Role.prototype, "parameters", void 0);
__decorate([
    ManyToMany(() => User, user => user.rolesDiscord),
    __metadata("design:type", Object)
], Role.prototype, "users", void 0);
Role = Role_1 = __decorate([
    Entity({ tableName: 'role' }),
    __metadata("design:paramtypes", [String, Object, Object])
], Role);
export { Role };
//# sourceMappingURL=Role.js.map