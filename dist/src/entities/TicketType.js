var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/TicketType.js
import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
let TicketType = class TicketType {
    /**
     * @param {string} name
     * @param {string|number} roleAuth
     */
    constructor(name, roleAuth) {
        this.name = name;
        // MikroORM stocke les bigints en string pour éviter les limites JS
        this.roleAuth = roleAuth.toString();
    }
    toString() {
        return this.name;
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], TicketType.prototype, "id", void 0);
__decorate([
    Property({ length: 255 }),
    __metadata("design:type", Object)
], TicketType.prototype, "name", void 0);
__decorate([
    Property({ type: 'bigint' }),
    __metadata("design:type", Object)
], TicketType.prototype, "roleAuth", void 0);
TicketType = __decorate([
    Entity({ tableName: 'ticket_type' }),
    __metadata("design:paramtypes", [String, BigInt])
], TicketType);
export { TicketType };
//# sourceMappingURL=TicketType.js.map