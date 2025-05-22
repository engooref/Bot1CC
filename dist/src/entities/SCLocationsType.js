var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/SCLocationsType.ts
import { Entity, PrimaryKey, Property, OneToMany, Collection, } from '@mikro-orm/core';
import { SCLocations } from './SCLocations.js';
let SCLocationsType = class SCLocationsType {
    /**
     * @param name Nom du type de location
     */
    constructor(name) {
        /** Liste des emplacements rattachés à ce type */
        this.locations = new Collection(this);
        this.name = name;
    }
    toString() {
        return this.name;
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], SCLocationsType.prototype, "id", void 0);
__decorate([
    Property({ length: 255 }),
    __metadata("design:type", String)
], SCLocationsType.prototype, "name", void 0);
__decorate([
    OneToMany(() => SCLocations, loc => loc.type),
    __metadata("design:type", Object)
], SCLocationsType.prototype, "locations", void 0);
SCLocationsType = __decorate([
    Entity({ tableName: 'sclocations_type' }),
    __metadata("design:paramtypes", [String])
], SCLocationsType);
export { SCLocationsType };
//# sourceMappingURL=SCLocationsType.js.map