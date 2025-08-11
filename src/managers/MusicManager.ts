import { Client, GuildMember } from 'discord.js';
import { Player, QueryType } from 'discord-player';
import { YoutubeiExtractor } from 'discord-player-youtubei';
import { DefaultExtractors } from '@discord-player/extractor';




export class MusicManager {
  private player: Player;

  constructor(client: Client) {
    this.player = new Player(client, {
      skipFFmpeg: false,
      connectionTimeout: 30000,
      
    });

    // Initialisation différée des extracteurs
    this.initExtractors();

    this.player.events.on('error', (queue, error) => {
      console.error('[MUSIC] Player error:', error);
    });
  }

  private async initExtractors() {
    // Charge les extracteurs par défaut
    this.player.extractors.loadMulti(DefaultExtractors);

    let oauthTokens = process.env.TOKEN;

    if (oauthTokens) {
      this.player.extractors.register(YoutubeiExtractor, {
        authentication: oauthTokens, // <-- chaîne brute, pas JSON.parse
        generateWithPoToken: true,
        streamOptions: {
          useClient: "WEB"
        }
      });
      
      const yi = this.player.extractors.get(YoutubeiExtractor.identifier);
      if (yi) yi.protocols.push("http", "https");

    }

  }
  

  async play(guildId: string, query: string, member: GuildMember) {
    // Crée ou récupère la queue
    const queue = this.player.nodes.create(member.guild, {
      metadata: { channel: member.voice.channel! },
      leaveOnEmpty: false,
      leaveOnEnd: false
    });

    // Connecte le bot si besoin
    if (!queue.connection) await queue.connect(member.voice.channel!);

    // Recherche le titre (YouTube/Spotify/...)
    const result = await this.player.search(query, {
      requestedBy: member,
      searchEngine: `ext:${YoutubeiExtractor.identifier}`
    });

    if (!result.tracks.length) {
      console.error(`[MUSIC] Aucun résultat trouvé pour la requête : ${query}`);
      console.error(`[MUSIC] Résultat brut :`, result);
      return null;
    }

    queue.addTrack(result.tracks[0]);
    if (!queue.isPlaying()) {
      await queue.node.play();
    }
    return result.tracks[0];
  }

  public async handleMusicCommand(interaction: any) {
    if (!interaction.isChatInputCommand()) return;
    const { guildId, member } = interaction;
    if (!guildId || !(member instanceof GuildMember)) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'play') {
      const query = interaction.options.getString('query', true);
      const track = await this.play(guildId, query, member);
      if (track) {
        await interaction.editReply(`▶️ Lecture : **${track.title}**`);
      } else {
        await interaction.editReply('Aucun résultat trouvé.');
      }
    } else if (sub === 'join') {
      const queue = this.player.nodes.create(member.guild, {
        metadata: { channel: member.voice.channel! }
      });
      if (!queue.connection) {
        await queue.connect(member.voice.channel!);
        await interaction.editReply('✅ Connecté au salon vocal.');
      } else {
        await interaction.editReply('Déjà connecté au salon vocal.');
      }
    } else if (sub === 'skip') {
      const queue = this.player.nodes.get(guildId);
      if (queue && queue.isPlaying()) {
        await queue.node.skip();
        await interaction.editReply('⏭️ Titre passé.');
      } else {
        await interaction.editReply('Aucune musique à passer.');
      }
    } else if (sub === 'pause') {
      const queue = this.player.nodes.get(guildId);
      if (queue && queue.node.isPlaying() && !queue.node.isPaused()) {
        queue.node.setPaused(true);
        await interaction.editReply('⏸️ Lecture en pause.');
      } else {
        await interaction.editReply('Aucune musique en cours ou déjà en pause.');
      }
    } else if (sub === 'resume') {
      const queue = this.player.nodes.get(guildId);
      if (queue && queue.node.isPaused()) {
        queue.node.setPaused(false);
        await interaction.editReply('▶️ Lecture reprise.');
      } else {
        await interaction.editReply('Aucune musique en pause.');
      }
    } else if (sub === 'list') {
      const queue = this.player.nodes.get(guildId);
      if (queue && (queue.currentTrack || queue.tracks.size > 0)) {
        let msg = '';
        if (queue.currentTrack) {
          msg += `🎶 **En cours**: ${queue.currentTrack.title}\n`;
        }
        if (queue.tracks.size > 0) {
          msg += `**File d'attente :**\n`;
          queue.tracks.toArray().forEach((track, i) => {
            msg += `${i + 1}. ${track.title}\n`;
          });
        }
        await interaction.editReply(msg);
      } else {
        await interaction.editReply('La file d\'attente est vide.');
      }
    }
    // Ajoute ici d'autres commandes si besoin
  }

  public getSlashHandlers(): Record<string, any> {
    return {
      musicHandler: this.handleMusicCommand.bind(this)
    };
  }
}

export default MusicManager;
