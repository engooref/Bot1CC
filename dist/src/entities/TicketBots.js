var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/TicketBots.ts
import { Entity, PrimaryKey, Property, ManyToOne, } from '@mikro-orm/core';
import { TicketType } from './TicketType.js';
let TicketBots = class TicketBots {
    constructor(type, userId, open) {
        /** Canal associé (0 si aucun) */
        this.channelId = '0';
        /** Utilisateur ayant fermé le ticket (0 si aucun) */
        this.closedUserId = '0';
        /** Date de fermeture, par défaut maintenant via la BDD */
        this.closed = new Date();
        /** Message de clôture */
        this.closedMessage = '';
        /** Sujet ou description du ticket */
        this.issue = '';
        this.type = type;
        this.userId = String(userId);
        this.open = open;
    }
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], TicketBots.prototype, "id", void 0);
__decorate([
    ManyToOne(() => TicketType),
    __metadata("design:type", TicketType)
], TicketBots.prototype, "type", void 0);
__decorate([
    Property({ type: 'bigint' }),
    __metadata("design:type", String)
], TicketBots.prototype, "userId", void 0);
__decorate([
    Property({ type: 'bigint', defaultRaw: '0' }),
    __metadata("design:type", String)
], TicketBots.prototype, "channelId", void 0);
__decorate([
    Property({ type: 'bigint', defaultRaw: '0' }),
    __metadata("design:type", String)
], TicketBots.prototype, "closedUserId", void 0);
__decorate([
    Property({ type: 'datetime' }),
    __metadata("design:type", Date)
], TicketBots.prototype, "open", void 0);
__decorate([
    Property({ type: 'datetime', defaultRaw: 'CURRENT_TIMESTAMP', nullable: false }),
    __metadata("design:type", Date)
], TicketBots.prototype, "closed", void 0);
__decorate([
    Property({ length: 255, default: '' }),
    __metadata("design:type", String)
], TicketBots.prototype, "closedMessage", void 0);
__decorate([
    Property({ length: 255, default: '' }),
    __metadata("design:type", String)
], TicketBots.prototype, "issue", void 0);
TicketBots = __decorate([
    Entity({ tableName: 'ticket_bot' }),
    __metadata("design:paramtypes", [TicketType, Object, Date])
], TicketBots);
export { TicketBots };
//# sourceMappingURL=TicketBots.js.map