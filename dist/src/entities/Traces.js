var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/Traces.ts
import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { User } from './User.js';
let Traces = class Traces {
    constructor(message, user, parameter) {
        this.message = message;
        this.user = user;
        this.parameter = parameter;
        // `time` sera rempli par la BDD via CURRENT_TIMESTAMP
    }
    toString() {
        return this.id?.toString() ?? '';
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], Traces.prototype, "id", void 0);
__decorate([
    ManyToOne(() => User, { nullable: true }),
    __metadata("design:type", Object)
], Traces.prototype, "user", void 0);
__decorate([
    Property({ length: 255 }),
    __metadata("design:type", String)
], Traces.prototype, "message", void 0);
__decorate([
    Property({ type: 'datetime', defaultRaw: 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], Traces.prototype, "time", void 0);
__decorate([
    Property({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], Traces.prototype, "parameter", void 0);
Traces = __decorate([
    Entity({ tableName: 'traces' }),
    __metadata("design:paramtypes", [String, User, String])
], Traces);
export { Traces };
//# sourceMappingURL=Traces.js.map