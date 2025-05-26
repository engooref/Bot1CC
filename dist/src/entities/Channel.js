var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/Channel.ts
import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
let Channel = class Channel {
    /**
     * @param name        Le nom du channel
     * @param discordId   L’ID Discord du channel (string ou number)
     */
    constructor(name, discordId) {
        this.name = name;
        // on stocke les bigints en string pour éviter les limites JS
        this.discordId = String(discordId);
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], Channel.prototype, "id", void 0);
__decorate([
    Property({ type: 'bigint', fieldName: 'discord_id' }),
    __metadata("design:type", String)
], Channel.prototype, "discordId", void 0);
__decorate([
    Property({ length: 255 }),
    __metadata("design:type", String)
], Channel.prototype, "name", void 0);
Channel = __decorate([
    Entity({ tableName: 'channel' }),
    __metadata("design:paramtypes", [String, Object])
], Channel);
export { Channel };
//# sourceMappingURL=Channel.js.map