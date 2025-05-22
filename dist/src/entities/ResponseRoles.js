var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/ResponseRoles.js
import { Entity, PrimaryKey, Property, ManyToMany, Collection, } from '@mikro-orm/core';
import { Response } from './Response.js';
let ResponseRoles = class ResponseRoles {
    constructor() {
        // Inverse side of the many-to-many with Response
        this.responses = new Collection(this);
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], ResponseRoles.prototype, "id", void 0);
__decorate([
    Property({ length: 255 }),
    __metadata("design:type", String)
], ResponseRoles.prototype, "name", void 0);
__decorate([
    Property({ length: 7 }),
    __metadata("design:type", String)
], ResponseRoles.prototype, "color", void 0);
__decorate([
    ManyToMany(() => Response, resp => resp.roles),
    __metadata("design:type", Object)
], ResponseRoles.prototype, "responses", void 0);
ResponseRoles = __decorate([
    Entity({ tableName: 'response_roles' })
], ResponseRoles);
export { ResponseRoles };
//# sourceMappingURL=ResponseRoles.js.map