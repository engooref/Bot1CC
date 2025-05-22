var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/ResponseTeam.js
import { Entity, PrimaryKey, Property, OneToMany, Collection, } from '@mikro-orm/core';
import { Response } from './Response.js';
let ResponseTeam = class ResponseTeam {
    constructor() {
        // Inverse side of the One-to-Many with Response
        this.responses = new Collection(this);
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], ResponseTeam.prototype, "id", void 0);
__decorate([
    Property({ length: 255 }),
    __metadata("design:type", String)
], ResponseTeam.prototype, "name", void 0);
__decorate([
    Property({ length: 7 }),
    __metadata("design:type", String)
], ResponseTeam.prototype, "color", void 0);
__decorate([
    OneToMany(() => Response, resp => resp.team),
    __metadata("design:type", Object)
], ResponseTeam.prototype, "responses", void 0);
ResponseTeam = __decorate([
    Entity({ tableName: 'response_team' })
], ResponseTeam);
export { ResponseTeam };
//# sourceMappingURL=ResponseTeam.js.map