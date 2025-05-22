var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/SCLocations.ts
import { Entity, PrimaryKey, Property, ManyToOne, OneToMany, Collection, } from '@mikro-orm/core';
import { SCLocationsType } from './SCLocationsType.js';
let SCLocations = class SCLocations {
    constructor(init) {
        this.name = '';
        this.designation = '';
        /**
         * One-to-Many vers les enfants
         * mappedBy via la propriété `parent`
         */
        this.children = new Collection(this);
        if (init) {
            Object.assign(this, init);
            // si on passe un tableau `children`, on l’instancie dans la Collection
            if (Array.isArray(init.children)) {
                this.children = new Collection(this, init.children);
            }
        }
    }
    toString() {
        return `${this.name} (${this.designation})`;
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], SCLocations.prototype, "id", void 0);
__decorate([
    Property({ length: 255, default: '' }),
    __metadata("design:type", String)
], SCLocations.prototype, "name", void 0);
__decorate([
    Property({ length: 255, default: '' }),
    __metadata("design:type", String)
], SCLocations.prototype, "designation", void 0);
__decorate([
    ManyToOne(() => SCLocationsType, { inversedBy: 'locations' }),
    __metadata("design:type", SCLocationsType)
], SCLocations.prototype, "type", void 0);
__decorate([
    ManyToOne(() => SCLocations, { nullable: true, inversedBy: 'children' }),
    __metadata("design:type", SCLocations)
], SCLocations.prototype, "parent", void 0);
__decorate([
    OneToMany(() => SCLocations, loc => loc.parent),
    __metadata("design:type", Object)
], SCLocations.prototype, "children", void 0);
SCLocations = __decorate([
    Entity({ tableName: 'sclocations' }),
    __metadata("design:paramtypes", [Object])
], SCLocations);
export { SCLocations };
//# sourceMappingURL=SCLocations.js.map