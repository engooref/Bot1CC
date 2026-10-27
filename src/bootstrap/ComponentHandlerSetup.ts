import {
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { BotManager } from '../BotManager.js';
import { componentHandlerRegistry } from '../registry/ComponentHandlerRegistry.js';
import { ComponentInteraction, ViewHandlers } from '../view/BaseView.js';
import { Handlers } from '../view/TicketsView.js';
import { RecruitmentActions } from '../view/RecrutementView.js';
import { GithubHandlers } from '../managers/GithubManager.js';
import type { AutoMessageState } from '../managers/AutoMessageManager.js';

export function registerComponentHandlers(bot: BotManager): void {
  componentHandlerRegistry.register(ViewHandlers.ParrainageHandler, async (interaction, data) => {
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())
      await bot.parrainageManager.handler(interaction, data);
  });
  componentHandlerRegistry.register(ViewHandlers.RecrutementHandler, async (interaction, data) => {
    if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith('parrain_'))
      await bot.parrainageManager.handler(interaction, data);
    else if (interaction.isButton() && interaction.customId === RecruitmentActions.Apply)
      await bot.recrutementManager.applyFromButton(interaction);
    else if (interaction.isButton() || interaction.isModalSubmit())
      await bot.recrutementManager.handler(interaction, data);
  });
  componentHandlerRegistry.register(ViewHandlers.DiploHandler, async (interaction, data) => {
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())
      await bot.diploManager.handlerResponse(interaction, data);
  });

  componentHandlerRegistry.register(ViewHandlers.InviteViewHandler, async (interaction, data) => {
    await (interaction as ButtonInteraction).deferUpdate();
    await bot.eventManager.userResponseHandle(interaction as ButtonInteraction, data);
  });

  componentHandlerRegistry.register(ViewHandlers.OperationHandler, async (interaction, data) => {
    if ((interaction as ButtonInteraction).customId === 'op_btn')
      await bot.operationManager.sendForm(interaction as ButtonInteraction);
    else
      await bot.operationManager.handlerForm(interaction as Parameters<typeof bot.operationManager.handlerForm>[0], data);
  });

  componentHandlerRegistry.register(ViewHandlers.TicketsHandler, async (interaction, data) => {
    if (interaction.isButton()) {
      if (interaction.customId === Handlers.OpenTicket)
        await bot.ticketManager.sendForm(interaction);
      else if (interaction.customId === Handlers.CloseTicket)
        await bot.ticketManager.closeForm(interaction, data);
    }
    else if ((interaction as StringSelectMenuInteraction).customId === Handlers.SelectType)
      await bot.ticketManager.createTickets(interaction as StringSelectMenuInteraction, data);
    else if (interaction.isModalSubmit())
      await bot.ticketManager.modalSubmit(interaction, data);
  });

  componentHandlerRegistry.register(ViewHandlers.EngaHandler, async (interaction, _) => {
    if (interaction.isButton())
      await bot.recrutementManager.applyFromButton(interaction);
  });

  componentHandlerRegistry.register(ViewHandlers.ScreenHandler, async (interaction, data) => {
    await bot.screenManager.handlerForm(interaction as ComponentInteraction, data);
  });

  componentHandlerRegistry.register(ViewHandlers.PromotionsHandler, async (interaction, _) => {
    await bot.userManager.removePromotion(interaction as ComponentInteraction);
  });

  componentHandlerRegistry.register(ViewHandlers.DuelHandler, async (interaction, data) => {
    await (interaction as ButtonInteraction).deferUpdate();
    await bot.duelManager.handleDuelCommand(interaction as ButtonInteraction, data);
  });

  componentHandlerRegistry.register(ViewHandlers.GithubHandler, async (interaction, data) => {
    if (interaction.isStringSelectMenu() && interaction.customId === GithubHandlers.SelectRepo)
      await bot.githubManager.handleSelectRepo(interaction as StringSelectMenuInteraction, data);
    else if (interaction.isModalSubmit())
      await bot.githubManager.handleModalSubmit(interaction, data);
  });

  componentHandlerRegistry.register(ViewHandlers.AutoMessageHandler, async (interaction, data) => {
    await bot.autoMessageManager.handlerForm(interaction as any, data as unknown as AutoMessageState);
  });

  componentHandlerRegistry.register(ViewHandlers.ScheduledResponseHandler, async (interaction, data) => {
    await bot.autoMessageManager.handlerResponse(interaction as ButtonInteraction, data);
  });

  componentHandlerRegistry.register(ViewHandlers.ContractHandler, async (interaction, data) => {
    await bot.contractManager.handlerResponse(interaction as ButtonInteraction, data);
  });
}
