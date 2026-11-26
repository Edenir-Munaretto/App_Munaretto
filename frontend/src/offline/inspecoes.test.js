import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  API_URL: 'http://api.teste/api',
  apiFetch: vi.fn(),
  erroDaResposta: (_dados, fallback) => fallback,
}));

import { apiFetch } from '../api';
import { limparTudoLocal } from './db';
import {
  contarPendentesInspecoes,
  criarInspecaoLocal,
  finalizarInspecaoLocal,
  haInspecoesDeOutroUsuario,
  obterInspecaoLocal,
  registrarFotoLocal,
  salvarRespostaLocal,
} from './inspecoes';
import { sincronizarInspecoes } from './syncInspecoes';

const MODELO = {
  id: 1,
  atividade_id: 1,
  nome: 'Inspeção de Segurança',
  itens: [
    {
      id: 11,
      grupo_ordem: 1,
      grupo_nome: 'Verificações',
      ordem: 1,
      classificacao: '1.1',
      pergunta: 'EPIs conferidos?',
      exige_foto: false,
    },
    {
      id: 12,
      grupo_ordem: 1,
      grupo_nome: 'Verificações',
      ordem: 2,
      classificacao: '1.2',
      pergunta: 'Área sinalizada?',
      exige_foto: true,
    },
  ],
};

function formBase(overrides = {}) {
  return {
    atividade: { id: 1, nome: 'Segurança' },
    modelo: MODELO,
    obra: { id: 7, nome: 'Obra Centro' },
    funcionario: { id: 10, nome: 'João Técnico', cargo: 'Eletricista' },
    equipe: { id: 5, nome: 'Equipe A', numero: '101', membros: [{ funcionario_id: 10, nome: 'João Técnico', cargo: 'Eletricista', lider: true }] },
    local_inspecao: 'Rua Comandante Caleffi, 55',
    data_inspecao: '2026-11-26',
    inspetor_nome: 'Técnico Campo',
    encarregado: 'João Técnico',
    veiculo: 'Caminhonete',
    setor: 'Segurança',
    assinantes: [{ funcionario_id: 10, nome: 'João Técnico', cargo: 'Eletricista' }],
    usuarioId: 7,
    ...overrides,
  };
}

describe('offline de inspeções', () => {
  beforeEach(async () => {
    await limparTudoLocal();
    apiFetch.mockReset();
  });

  it('cria o rascunho local com snapshot do modelo', async () => {
    const registro = await criarInspecaoLocal(formBase());
    expect(registro.id_local).toMatch(/^insp-/);
    expect(registro.status).toBe('rascunho');
    expect(registro.pendente_sync).toBe(true);
    expect(registro.itens).toHaveLength(2);
    expect(registro.obra_nome).toBe('Obra Centro');
    expect(registro.equipe_nome).toBe('Equipe A');
  });

  it('bloqueia finalização sem resposta/observação/foto e libera quando completo', async () => {
    const registro = await criarInspecaoLocal(formBase());
    await expect(finalizarInspecaoLocal(registro.id_local)).rejects.toThrow(/sem resposta/);

    await salvarRespostaLocal(registro.id_local, '1.1', 'conforme');
    await salvarRespostaLocal(registro.id_local, '1.2', 'nao_conforme', '');
    await expect(finalizarInspecaoLocal(registro.id_local)).rejects.toThrow(/observação obrigatória/);

    await salvarRespostaLocal(registro.id_local, '1.2', 'nao_conforme', 'Área sem sinalização');
    const arquivo = new File(['foto'], 'evidencia.jpg', { type: 'image/jpeg' });
    await registrarFotoLocal({
      idLocal: registro.id_local,
      classificacao: '1.2',
      arquivo,
      capturado_em: '2026-11-26T10:00:00Z',
      geolocalizacao: '-27.0,-52.0',
    });

    const finalizada = await finalizarInspecaoLocal(registro.id_local);
    expect(finalizada.status).toBe('concluida');
    const local = await obterInspecaoLocal(registro.id_local);
    expect(local.itens.find((i) => i.classificacao === '1.2').fotos).toHaveLength(1);
  });

  it('conta pendências e identifica dados de outro usuário', async () => {
    const registro = await criarInspecaoLocal(formBase({ usuarioId: 7 }));
    const contagem = await contarPendentesInspecoes();
    expect(contagem.inspecoes).toBe(1);
    expect(await haInspecoesDeOutroUsuario(7)).toBe(false);
    expect(await haInspecoesDeOutroUsuario(8)).toBe(true);
    expect(registro.usuario_id).toBe(7);
  });

  it('sincroniza criação, foto e finalização e limpa a fila local', async () => {
    // O fake-indexeddb do jsdom não preserva Blob; o FormData é stubado para
    // evitar o TypeError do append (o upload real é validado no navegador).
    class FormDataFake {
      constructor() { this.campos = {}; }

      append(chave, valor) { this.campos[chave] = valor; }

      get(chave) { return this.campos[chave]; }
    }
    vi.stubGlobal('FormData', FormDataFake);

    apiFetch.mockImplementation(async (url, options = {}) => {
      const alvo = String(url);
      if (alvo.endsWith('/inspecoes/sincronizar')) {
        const corpo = JSON.parse(options.body);
        const op = corpo.operacoes[0];
        return {
          ok: true,
          status: 200,
          json: async () => ({
            resultados: [
              {
                ok: true,
                id_local: op.id_local,
                inspecao_id: 1,
                codigo: 'INS-2026-0001',
              },
            ],
          }),
        };
      }
      if (alvo.includes('/fotos')) {
        return { ok: true, status: 201, json: async () => ({ id: 99, url_temporaria: 'https://foto' }) };
      }
      return { ok: false, status: 404, json: async () => null };
    });

    const registro = await criarInspecaoLocal(formBase());
    await salvarRespostaLocal(registro.id_local, '1.1', 'conforme');
    await salvarRespostaLocal(registro.id_local, '1.2', 'na', 'Não se aplica');
    const arquivo = new File(['foto'], 'evidencia.jpg', { type: 'image/jpeg' });
    await registrarFotoLocal({
      idLocal: registro.id_local,
      classificacao: '1.2',
      arquivo,
      capturado_em: '2026-11-26T10:00:00Z',
    });
    await finalizarInspecaoLocal(registro.id_local);

    const resumo = await sincronizarInspecoes();
    expect(resumo.falhas).toEqual([]);
    expect(resumo.inspecoes).toBe(1);
    expect(resumo.fotos).toBe(1);

    const local = await obterInspecaoLocal(registro.id_local);
    expect(local.id_servidor).toBe(1);
    expect(local.codigo).toBe('INS-2026-0001');
    expect(local.pendente_sync).toBe(false);

    const pendentes = await contarPendentesInspecoes();
    expect(pendentes.total).toBe(0);
    vi.unstubAllGlobals();
  });
});
