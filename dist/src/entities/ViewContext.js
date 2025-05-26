var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// src/entities/InteractionContext.ts
import { Entity, PrimaryKey, Property, Enum } from '@mikro-orm/core';
export var ComponentType;
(function (ComponentType) {
    ComponentType["Button"] = "button";
    ComponentType["Select"] = "select";
})(ComponentType || (ComponentType = {}));
let InteractionContext = class InteractionContext {
};
__decorate([
    PrimaryKey(),
    __metadata("design:type", Number)
], InteractionContext.prototype, "id", void 0);
__decorate([
    Property(),
    __metadata("design:type", String)
], InteractionContext.prototype, "messageId", void 0);
__decorate([
    Property(),
    __metadata("design:type", String)
], InteractionContext.prototype, "channelId", void 0);
__decorate([
    Property(),
    __metadata("design:type", String)
], InteractionContext.prototype, "customId", void 0);
__decorate([
    Property(),
    __metadata("design:type", String)
], InteractionContext.prototype, "handlerKey", void 0);
__decorate([
    Enum({ items: () => Object.values(ComponentType) }),
    __metadata("design:type", String)
], InteractionContext.prototype, "componentType", void 0);
__decorate([
    Property({ type: 'json', columnType: 'text' }),
    __metadata("design:type", Object)
], InteractionContext.prototype, "data", void 0);
InteractionContext = __decorate([
    Entity({ tableName: 'view_context' })
], InteractionContext);
export { InteractionContext };
//# sourceMappingURL=ViewContext.js.map