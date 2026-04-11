import { execFileSync, spawn } from "child_process";
import path from "path";
import sharp from "sharp";
import { getManagerLogger } from "../logger.js";
import fs from 'fs';

export class SVGManager {
    private logger = getManagerLogger('SVGManager');

    constructor(private data: any, private config: any) {}

    // 2. Appliquer le XSLT via la commande système xsltproc
    public async transformSvgWithXsltproc(svgTemplatePath: string, xsltPath: string): Promise<string> {
      await this.logger.debug({ msg: `Transformation du SVG via xsltproc avec template ${svgTemplatePath}` });
  
      const absXsltPath = path.resolve(xsltPath);
      const absSvgPath  = path.resolve(svgTemplatePath);
  
      const tmpXmlPath = path.join(this.config.baseDir, 'generic.xml');
      const xmlContent = ['<?xml version="1.0" encoding="UTF-8"?>', '<base>'];
      xmlContent.push(...this.objectToXml(this.data, ' '))
      xmlContent.push('</base>');
      fs.writeFileSync(tmpXmlPath, xmlContent.join("\n"), 'utf8');
  
      return new Promise((resolve, reject) => {
        const proc = spawn('xsltproc', [absXsltPath, absSvgPath], {
          cwd: this.config.baseDir,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', chunk => { stdout += chunk; });
        proc.stderr.on('data', chunk => { stderr += chunk; });

        proc.on('error', err => reject(err));
        proc.on('close', code => {
          fs.unlinkSync(tmpXmlPath);

          if (code === 0) {
            resolve(stdout);
          } else {
            reject(new Error(`xsltproc exited ${code}: ${stderr}`));
          }
        });
      });
    }

    escapeXml(str: string): string {
      return str.replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
    }

    objectToXml(obj: Record<string, any>, indent = '  '): string[] {
      const lines: string[] = [];

      for (const [key, val] of Object.entries(obj)) {
        if (val == null) continue;

        // Cas tableau
        if (Array.isArray(val)) {
          const itemName = key.endsWith('s') ? key.slice(0, -1) : 'item';
          lines.push(`${indent}<${key}>`);
          for (const entry of val) {
            if (typeof entry === 'object') {
              lines.push(`${indent}  <${itemName}>`);
              lines.push(...this.objectToXml(entry, indent + '    '));
              lines.push(`${indent}  </${itemName}>`);
            } else {
              lines.push(`${indent}  <${itemName}>${this.escapeXml(String(entry))}</${itemName}>`);
            }
          }
          lines.push(`${indent}</${key}>`);
          continue;
        }

        // Cas objet imbriqué
        if (typeof val === 'object') {
          lines.push(`${indent}<${key}>`);
          lines.push(...this.objectToXml(val, indent + '  '));
          lines.push(`${indent}</${key}>`);
          continue;
        }

        // Cas scalaire
        lines.push(`${indent}<${key}>${this.escapeXml(String(val))}</${key}>`);
      }

      return lines;
    }

  
    // 3. Convertir le SVG généré en PNG (sharp)
    async svgToPng(svgString: string, outputPath: string) {
      await sharp(Buffer.from(svgString))
        .png()
        .toFile(outputPath);
    }
  
    // Fonction principale
    async generateImage() {
      try {
  
        const { svgTemplatePath, xsltPath, outputSvgPath, outputPngPath } = this.config;
  
        if (!fs.existsSync(svgTemplatePath)) {
          throw new Error('SVG template non trouvé: ' + svgTemplatePath);
        }
        if (!fs.existsSync(xsltPath)) {
          throw new Error('XSLT template non trouvé: ' + xsltPath);
        }
  
        const transformedSvg = await this.transformSvgWithXsltproc(svgTemplatePath, xsltPath);
        fs.writeFileSync(outputSvgPath, transformedSvg, 'utf-8');
        await this.logger.debug({ msg: `SVG généré: ${outputSvgPath}` });
  
        // Convertir en PNG
        await this.svgToPng(transformedSvg, outputPngPath);
        
      } catch (err) {
        await this.logger.error({ msg: "Erreur lors de la génération de l'image :", err });
  
      }
    }
}