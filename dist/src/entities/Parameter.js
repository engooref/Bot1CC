var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/Parameter.ts
import { Entity, PrimaryKey, Property, ManyToOne, ManyToMany, Collection, } from '@mikro-orm/core';
import { ParameterType } from './ParameterType.js';
import { Channel } from './Channel.js';
import { Role } from './Role.js';
let Parameter = class Parameter {
    constructor() {
        this.roles = new Collection(this);
    }
    /**
     * Retourne la valeur selon le typeParam
     */
    getValue() {
        switch (this.valueType.type_param) {
            case 'Text':
                return this.valueText ?? '';
            case 'Channel':
                return this.valueChannel?.discordId ?? ''; // on utilise discordId, pas discord_id
            case 'Role':
                return this.roles.getItems().map(r => r.discordId);
            default:
                return '';
        }
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], Parameter.prototype, "id", void 0);
__decorate([
    Property({ length: 255 }),
    __metadata("design:type", String)
], Parameter.prototype, "name", void 0);
__decorate([
    ManyToOne(() => ParameterType, {}),
    __metadata("design:type", ParameterType)
], Parameter.prototype, "valueType", void 0);
__decorate([
    ManyToOne(() => Channel, { nullable: true }),
    __metadata("design:type", Object)
], Parameter.prototype, "valueChannel", void 0);
__decorate([
    ManyToMany(() => Role, role => role.parameters, {
        owner: true,
        pivotTable: 'parameter_role',
    }),
    __metadata("design:type", Object)
], Parameter.prototype, "roles", void 0);
__decorate([
    Property({ length: 255, nullable: true }),
    __metadata("design:type", String)
], Parameter.prototype, "valueText", void 0);
Parameter = __decorate([
    Entity({ tableName: 'parameter' })
], Parameter);
export { Parameter };
//# sourceMappingURL=Parameter.js.map