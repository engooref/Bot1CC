var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/Response.ts
import { Entity, PrimaryKey, Property, ManyToOne, ManyToMany, Collection, } from '@mikro-orm/core';
import { User } from './User.js';
import { Event } from './Event.js';
import { ResponseTeam } from './ResponseTeam.js';
import { ResponseRoles } from './ResponseRoles.js';
let Response = class Response {
    constructor(init) {
        this.roleDemand = [];
        this.roles = new Collection(this);
        if (init) {
            this.users = init.user;
            this.event = init.event;
            this.typeRep = init.typeRep;
            this.team = init.team;
            this.commentaire = init.commentaire;
            this.vaisseau = init.vaisseau;
            this.roleVaisseau = init.roleVaisseau;
            this.roleDemand = init.roleDemand ?? [];
            // **on n’accepte qu’un tableau**, pas une Collection**
            if (Array.isArray(init.roles)) {
                // réinitialise la Collection avec les items du tableau
                this.roles = new Collection(this, init.roles);
            }
        }
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], Response.prototype, "id", void 0);
__decorate([
    ManyToOne(() => User),
    __metadata("design:type", Object)
], Response.prototype, "users", void 0);
__decorate([
    ManyToOne(() => Event, { inversedBy: 'responses' }),
    __metadata("design:type", Object)
], Response.prototype, "event", void 0);
__decorate([
    Property({ length: 255 }),
    __metadata("design:type", String)
], Response.prototype, "typeRep", void 0);
__decorate([
    ManyToOne(() => ResponseTeam, { nullable: true, inversedBy: 'responses' }),
    __metadata("design:type", Object)
], Response.prototype, "team", void 0);
__decorate([
    Property({ length: 255, nullable: true }),
    __metadata("design:type", String)
], Response.prototype, "commentaire", void 0);
__decorate([
    Property({ length: 255, nullable: true }),
    __metadata("design:type", String)
], Response.prototype, "vaisseau", void 0);
__decorate([
    Property({ length: 255, nullable: true }),
    __metadata("design:type", String)
], Response.prototype, "roleVaisseau", void 0);
__decorate([
    Property({ type: 'json', default: [] }),
    __metadata("design:type", Array)
], Response.prototype, "roleDemand", void 0);
__decorate([
    ManyToMany(() => ResponseRoles, r => r.responses, {
        owner: true,
        pivotTable: 'response_event_response_roles',
        joinColumn: 'response_event_id', // nom exact de la FK vers Response
        inverseJoinColumn: 'response_roles_id',
    }),
    __metadata("design:type", Object)
], Response.prototype, "roles", void 0);
Response = __decorate([
    Entity({ tableName: 'response_event' }),
    __metadata("design:paramtypes", [Object])
], Response);
export { Response };
//# sourceMappingURL=Response.js.map