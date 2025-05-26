var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/RHMember.ts
import { Entity, PrimaryKey, Property, OneToOne, ManyToOne, } from '@mikro-orm/core';
// ← IMPORT NORMAL pour le runtime
import { User } from './User.js';
import { Role } from './Role.js';
let RHMember = class RHMember {
    constructor() {
        this.status = 'Actif';
        this.dateEntree = new Date(0);
        this.dateDemand = new Date(0);
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], RHMember.prototype, "id", void 0);
__decorate([
    OneToOne(() => User, user => user.rhProfile, { owner: true, nullable: true, orphanRemoval: true }),
    __metadata("design:type", Object)
], RHMember.prototype, "user", void 0);
__decorate([
    Property({ length: 255, default: 'Actif' }),
    __metadata("design:type", String)
], RHMember.prototype, "status", void 0);
__decorate([
    Property({ type: 'datetime', nullable: true, defaultRaw: 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], RHMember.prototype, "lastPromotion", void 0);
__decorate([
    ManyToOne(() => Role, { inversedBy: 'rHMembers', nullable: true }),
    __metadata("design:type", Object)
], RHMember.prototype, "grade", void 0);
__decorate([
    Property({ type: 'datetime', nullable: false, defaultRaw: "'1970-01-01 00:00:00'" }),
    __metadata("design:type", Date)
], RHMember.prototype, "dateEntree", void 0);
__decorate([
    Property({ type: 'datetime', nullable: false, defaultRaw: "'1970-01-01 00:00:00'" }),
    __metadata("design:type", Date)
], RHMember.prototype, "dateDemand", void 0);
RHMember = __decorate([
    Entity({ tableName: 'rhmember' })
], RHMember);
export { RHMember };
//# sourceMappingURL=RHMember.js.map