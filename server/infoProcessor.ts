import type {
  CollectedResearchData,
  ColorSwatch,
  ScreenBlueprint,
  VerificationStatus,
} from '../src/types/blueprint.ts';
import { normalizeHttpUrl } from './universalResearch.ts';

export type BusinessArchetype =
  | 'cultura_entretenimento'
  | 'gastronomia'
  | 'saude_clinica'
  | 'beleza_estetica'
  | 'automotivo'
  | 'varejo_loja'
  | 'tecnologia_b2b'
  | 'servicos_locais';

export interface ProcessedCompanyContext {
  businessName: string;
  legalName: string | null;
  cnpj: string | null;
  category: string;
  archetype: BusinessArchetype;
  archetypeLabel: string;
  address: string;
  phone: string;
  whatsapp: string | null;
  whatsappTargetHint: string;
  hours: string;
  locationSummary: string;
  productsAndServices: string[];
  reviewsAndDifferentiators: string;
  visualReferences: string;
  identityAndPositioning: string;
  verifiedGoogleMapsUrl: string;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  limitations: string[];
  fieldStatuses: Record<string, VerificationStatus>;
  palette: ColorSwatch[];
  sectorScreens: ScreenBlueprint[];
  primaryCtaLabel: string;
  secondaryCtaLabel: string;
}

function detectArchetype(collected: CollectedResearchData): {
  archetype: BusinessArchetype;
  label: string;
} {
  const haystack = [
    collected.placeName,
    collected.legalName,
    collected.segment,
    collected.metaDescription,
    ...(collected.productsAndServices || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/(museu|galeria|teatro|cinema|cultura|arte|exposi|centro cultural|turismo|evento)/i.test(haystack)) {
    return { archetype: 'cultura_entretenimento', label: 'Cultura, Arte e Entretenimento' };
  }
  if (/(restaurante|pizzaria|hamburgueria|padaria|cafeteria|lanchonete|bar|bistrô|confeitaria|gastronomia|aliment|açaí)/i.test(haystack)) {
    return { archetype: 'gastronomia', label: 'Gastronomia e Alimentação' };
  }
  if (/(clínica|clinica|odonto|dentista|médic|medic|hospital|fisioterapia|psicolog|laboratório|saúde|saude|farmácia)/i.test(haystack)) {
    return { archetype: 'saude_clinica', label: 'Saúde, Clínicas e Bem-Estar' };
  }
  if (/(barbearia|salão|salao|estética|estetica|manicure|beleza|spa|cabelereir|sobrancelha)/i.test(haystack)) {
    return { archetype: 'beleza_estetica', label: 'Beleza e Estética' };
  }
  if (/(oficina|mecânica|mecanica|auto|funilaria|pneu|veículo|veiculo|concessionária|estética automotiva|moto)/i.test(haystack)) {
    return { archetype: 'automotivo', label: 'Automotivo e Manutenção' };
  }
  if (/(software|tecnologia|sistema|ti|agência|agencia|marketing|consultoria|contabilidade|advocacia|engenharia)/i.test(haystack)) {
    return { archetype: 'tecnologia_b2b', label: 'Serviços Especializados e Tecnologia' };
  }
  if (/(loja|comércio|comercio|boutique|moda|móveis|moveis|supermercado|pet shop|eletrônicos|atacado|varejo)/i.test(haystack)) {
    return { archetype: 'varejo_loja', label: 'Comércio e Varejo' };
  }
  return { archetype: 'servicos_locais', label: 'Atendimento e Serviços Locais' };
}

function buildSectorPalette(archetype: BusinessArchetype): ColorSwatch[] {
  const accentMap: Record<BusinessArchetype, { name: string; hex: string; secondaryName: string; secondaryHex: string }> = {
    cultura_entretenimento: {
      name: 'Ciano Galeria Neon',
      hex: '#22D3EE',
      secondaryName: 'Violeta Curatorial',
      secondaryHex: '#818CF8',
    },
    gastronomia: {
      name: 'Âmbar Gourmet',
      hex: '#F59E0B',
      secondaryName: 'Coral Brasa',
      secondaryHex: '#FB7185',
    },
    saude_clinica: {
      name: 'Turquesa Clínico',
      hex: '#2DD4BF',
      secondaryName: 'Azul Precisão',
      secondaryHex: '#38BDF8',
    },
    beleza_estetica: {
      name: 'Rosa Quartzo Neon',
      hex: '#F472B6',
      secondaryName: 'Violeta Seda',
      secondaryHex: '#A78BFA',
    },
    automotivo: {
      name: 'Ciano Performance',
      hex: '#06B6D4',
      secondaryName: 'Laranja Torque',
      secondaryHex: '#F97316',
    },
    varejo_loja: {
      name: 'Ciano Vitrine',
      hex: '#22D3EE',
      secondaryName: 'Esmeralda Conversão',
      secondaryHex: '#34D399',
    },
    tecnologia_b2b: {
      name: 'Ciano Arquitetônico',
      hex: '#22D3EE',
      secondaryName: 'Índigo Profundo',
      secondaryHex: '#6366F1',
    },
    servicos_locais: {
      name: 'Ciano Neon Calibrado',
      hex: '#22D3EE',
      secondaryName: 'Índigo Profundo',
      secondaryHex: '#6366F1',
    },
  };

  const accent = accentMap[archetype];
  return [
    {
      name: 'Obsidiana Espacial',
      hex: '#080D1A',
      role: 'Fundo Dominante (60%)',
      usage: 'Canvas principal com profundidade escura e alto contraste WCAG AA.',
    },
    {
      name: 'Ardósia Estrutural',
      hex: '#111A2E',
      role: 'Superfícies 3D (30%)',
      usage: 'Cartões em camadas, painéis de catálogo e barra de navegação.',
    },
    {
      name: accent.name,
      hex: accent.hex,
      role: 'Acento Primário (10%)',
      usage: 'Botões principais de conversão, indicadores ativos e estados de foco.',
    },
    {
      name: accent.secondaryName,
      hex: accent.secondaryHex,
      role: 'Acento Secundário',
      usage: 'Luz de recorte nos elementos 3D e destaques complementares.',
    },
    {
      name: 'Branco Mineral',
      hex: '#F8FAFC',
      role: 'Tipografia Principal',
      usage: 'Títulos e leitura confortável em telas mobile.',
    },
  ];
}

function buildSectorPortfolioAndScreens(
  archetype: BusinessArchetype,
  businessName: string,
  collected: CollectedResearchData,
  verifiedGoogleMapsUrl: string
): {
  defaultOfferings: string[];
  screens: ScreenBlueprint[];
  primaryCta: string;
  secondaryCta: string;
} {
  const mapOrChannelsBtn = verifiedGoogleMapsUrl ? 'Traçar Rota no Maps' : 'Ver Canais Oficiais';
  const mapOrCopyBtn = verifiedGoogleMapsUrl ? 'Abrir no Google Maps' : 'Copiar Endereço';

  switch (archetype) {
    case 'cultura_entretenimento':
      return {
        defaultOfferings: [
          'Programação cultural, acervos e experiências presenciais',
          'Informações de visitação, horários e orientações ao público',
          'Atendimento institucional e dúvidas via canais oficiais verificados',
        ],
        primaryCta: 'Planejar Visita / Atendimento',
        secondaryCta: mapOrChannelsBtn,
        screens: [
          {
            id: 'home',
            name: 'Início & Destaques',
            route: '/',
            purpose: `Apresentar "${businessName}" com impacto visual 3D, horários confirmados e atalho rápido de visitação.`,
            layoutStructure: 'Hero espacial em destaque com faixa de visitação, CTAs arredondados e cartão institucional.',
            keyComponents: ['Cabeçalho limpo de 3 zonas', 'Bloco Hero com profundidade 3D', 'Cartão de visitação e horários', 'Links oficiais verificados'],
            primaryButtons: ['Falar no WhatsApp', mapOrChannelsBtn],
            userInteractions: ['Acesso em 1 toque a canais oficiais', 'Consulta rápida de endereço e horários'],
          },
          {
            id: 'programacao',
            name: 'Atrações & Serviços',
            route: '/programacao',
            purpose: 'Organizar atividades, exposições ou serviços disponíveis ao visitante com busca instantânea.',
            layoutStructure: 'Filtros segmentados no topo e grade responsiva de cartões 3D.',
            keyComponents: ['Filtro por tema/categoria', 'Cartões 3D com resumo objetivo', 'Botão de dúvida contextualizada'],
            primaryButtons: ['Tirar Dúvida no WhatsApp', 'Ver Detalhes'],
            userInteractions: ['Filtragem em tempo real', 'Pré-preenchimento do assunto no contato'],
          },
          {
            id: 'localizacao',
            name: 'Visitação & Dados Oficiais',
            route: '/localizacao',
            purpose: 'Concentrar endereço, CNPJ/razão social (quando confirmados), horários e rota direta.',
            layoutStructure: 'Painel dividido com dados cadastrais verificados e botões de cópia rápida.',
            keyComponents: ['Quadro de horários e endereço', 'Registro cadastral verificado', 'Acesso direto ao mapa'],
            primaryButtons: [mapOrCopyBtn, 'Copiar Telefone'],
            userInteractions: ['Cópia de dados com feedback visual', 'Abertura de rota em 1 toque'],
          },
          {
            id: 'contato',
            name: 'Contato & Redes Sociais',
            route: '/contato',
            purpose: 'Centralizar o atendimento ao visitante e os perfis digitais reais da instituição.',
            layoutStructure: 'Pré-atendimento rápido com links diretos para Site, Instagram e Facebook confirmados.',
            keyComponents: ['Seletor de assunto', 'Direcionamento direto ao canal oficial', 'Botão de compartilhamento'],
            primaryButtons: ['Iniciar Atendimento', 'Compartilhar Aplicativo'],
            userInteractions: ['Compartilhamento via Web Share API', 'Abertura direta dos perfis sociais'],
          },
        ],
      };

    case 'gastronomia':
      return {
        defaultOfferings: [
          'Cardápio organizado por categorias com destaques da casa',
          'Pedidos e reservas rápidas com mensagem estruturada no WhatsApp',
          'Consulta imediata de endereço, horários e retirada no local',
        ],
        primaryCta: 'Pedir / Reservar no WhatsApp',
        secondaryCta: mapOrChannelsBtn,
        screens: [
          {
            id: 'home',
            name: 'Vitrine da Casa',
            route: '/',
            purpose: `Despertar interesse imediato em "${businessName}" com acesso em 1 toque ao cardápio e WhatsApp.`,
            layoutStructure: 'Hero apetitoso com destaques, selo de horário de atendimento e dois CTAs principais.',
            keyComponents: ['Hero com fotografia real da marca', 'Faixa de horário e localização', 'Acesso rápido ao cardápio'],
            primaryButtons: ['Pedir no WhatsApp', 'Ver Cardápio'],
            userInteractions: ['Abertura imediata do cardápio', 'Conversa direta com pedido pré-montado'],
          },
          {
            id: 'cardapio',
            name: 'Cardápio Interativo',
            route: '/cardapio',
            purpose: 'Listar pratos, combos ou produtos com busca por nome e seleção para orçamento/pedido.',
            layoutStructure: 'Abas de categorias fixas no topo com cartões 3D e resumo rápido.',
            keyComponents: ['Busca instantânea', 'Categorias deslizáveis', 'Cartões com botão de adicionar ao pedido'],
            primaryButtons: ['Enviar Pedido no WhatsApp', 'Ver Ingredientes'],
            userInteractions: ['Montagem leve de lista de itens', 'Envio da lista pronta no WhatsApp'],
          },
          {
            id: 'localizacao',
            name: 'Localização & Horários',
            route: '/localizacao',
            purpose: 'Mostrar endereço confirmado, rota no mapa e dados oficiais do estabelecimento.',
            layoutStructure: 'Cartão de endereço + bloco cadastral verificado.',
            keyComponents: ['Endereço e horários', 'Dados oficiais (CNPJ quando confirmado)', 'Atalho para rota'],
            primaryButtons: [mapOrCopyBtn, 'Copiar Endereço'],
            userInteractions: ['Rota em 1 toque', 'Cópia instantânea do endereço'],
          },
          {
            id: 'contato',
            name: 'Reservas & Redes',
            route: '/contato',
            purpose: 'Facilitar reservas de mesa, encomendas e acesso ao Instagram/site reais.',
            layoutStructure: 'Formulário leve de pré-atendimento + cartões de redes sociais.',
            keyComponents: ['Campo de nome e horário desejado', 'Botão WhatsApp contextualizado', 'Links sociais verificados'],
            primaryButtons: ['Solicitar Reserva', 'Compartilhar'],
            userInteractions: ['Geração automática de mensagem wa.me', 'Web Share API'],
          },
        ],
      };

    default:
      return {
        defaultOfferings: [
          collected.segment
            ? `Soluções e atendimento especializado em ${collected.segment}`
            : 'Catálogo de produtos e serviços comerciais sob medida',
          'Agendamento ou solicitação de orçamento direto pelo WhatsApp',
          'Consulta rápida de endereço, horários e credenciais públicas da empresa',
        ],
        primaryCta: 'Falar no WhatsApp',
        secondaryCta: mapOrChannelsBtn,
        screens: [
          {
            id: 'home',
            name: 'Início & Apresentação',
            route: '/',
            purpose: `Apresentar "${businessName}" com autoridade visual 3D e direcionar para WhatsApp e canais oficiais.`,
            layoutStructure: 'Hero em destaque com resumo institucional confirmado, dois CTAs arredondados e diferenciais.',
            keyComponents: ['Cabeçalho limpo de 3 zonas', 'Bloco Hero com profundidade 3D', 'Cartões de destaque de atendimento', 'Bloco de transparência cadastral'],
            primaryButtons: ['Falar no WhatsApp', mapOrChannelsBtn],
            userInteractions: ['Toque direto para contato ou rota', 'Pré-visualização interativa dos serviços'],
          },
          {
            id: 'catalogo',
            name: 'Produtos & Serviços',
            route: '/servicos',
            purpose: 'Organizar o portfólio comercial da empresa com busca rápida e solicitação contextualizada.',
            layoutStructure: 'Filtro segmentado no topo seguido de grade responsiva de cartões 3D.',
            keyComponents: ['Barra de busca instantânea', 'Filtros por categoria', 'Cartões 3D com botão de orçamento'],
            primaryButtons: ['Solicitar no WhatsApp', 'Ver Detalhes'],
            userInteractions: ['Filtragem em tempo real', 'Preenchimento automático do assunto no WhatsApp'],
          },
          {
            id: 'localizacao',
            name: 'Localização & Dados Oficiais',
            route: '/localizacao',
            purpose: 'Exibir endereço, CNPJ/razão social (quando verificados), horários e botão de rota.',
            layoutStructure: 'Painel dividido com dados cadastrais verificados e acesso direto a mapa/endereço.',
            keyComponents: ['Quadro de horários e endereço', 'Bloco cadastral verificado', 'Botões para canais oficiais'],
            primaryButtons: [mapOrCopyBtn, 'Copiar Telefone'],
            userInteractions: ['Cópia de dados com feedback visual', 'Abertura de rota em 1 toque'],
          },
          {
            id: 'contato',
            name: 'Atendimento & Redes',
            route: '/contato',
            purpose: 'Centralizar o contato rápido via WhatsApp e os canais sociais reais encontrados.',
            layoutStructure: 'Pré-atendimento leve montando mensagem estruturada para envio direto via WhatsApp.',
            keyComponents: ['Seletor de assunto', 'Campo de nome e dúvida', 'Links verificados (Site, Instagram, Facebook)'],
            primaryButtons: ['Enviar Mensagem no WhatsApp', 'Compartilhar Aplicativo'],
            userInteractions: ['Geração de link wa.me contextualizado', 'Compartilhamento nativo via Web Share API'],
          },
        ],
      };
  }
}

export function processCollectedCompanyInfo(
  collected: CollectedResearchData,
  extraLimitation?: string
): ProcessedCompanyContext {
  const businessName =
    collected.placeName ||
    collected.legalName ||
    collected.metaTitle ||
    collected.queryHint ||
    'Empresa Identificada';

  const { archetype, label: archetypeLabel } = detectArchetype(collected);

  const verifiedGoogleMapsUrl =
    normalizeHttpUrl(collected.googleMapsUrl) ||
    normalizeHttpUrl(collected.resolvedMapsUrl) ||
    '';

  const sectorPack = buildSectorPortfolioAndScreens(
    archetype,
    businessName,
    collected,
    verifiedGoogleMapsUrl
  );

  const locationSummary = collected.cityState
    ? collected.cityState
    : collected.latLng
      ? `Coordenadas: ${collected.latLng.latitude.toFixed(6)}, ${collected.latLng.longitude.toFixed(6)}`
      : collected.sourceOrigin
        ? `Origem: ${collected.sourceOrigin}`
        : 'Localização não detalhada';

  const limitations: string[] = [...(collected.limitations || [])];
  if (extraLimitation && !limitations.includes(extraLimitation)) {
    limitations.unshift(extraLimitation);
  }
  if (!collected.phone && !collected.whatsapp) {
    limitations.push('Telefone/WhatsApp não localizado nas fontes públicas consultadas.');
  }
  if (!collected.hours) {
    limitations.push('Horários de funcionamento não localizados nas fontes públicas consultadas.');
  }
  if (!collected.website) {
    limitations.push('Site institucional oficial não localizado ou ausente.');
  }

  const whatsappTargetHint = collected.whatsapp
    ? `wa.me/${collected.whatsapp}`
    : collected.phone
      ? `canal telefônico (${collected.phone})`
      : 'link wa.me (inserir número oficial confirmado em businessConfig.ts)';

  const productsAndServices =
    collected.productsAndServices && collected.productsAndServices.length > 0
      ? collected.productsAndServices
      : sectorPack.defaultOfferings;

  const category =
    collected.segment ||
    (collected.metaDescription
      ? `Segmento inferido dos metadados: ${collected.metaDescription}`
      : `${archetypeLabel} (confirmar especialidade exata com a empresa)`);

  return {
    businessName,
    legalName: collected.legalName || null,
    cnpj: collected.cnpj || null,
    category,
    archetype,
    archetypeLabel,
    address:
      collected.address ||
      'Não localizado nas fontes públicas consultadas (confirmar endereço antes da publicação)',
    phone:
      collected.phone ||
      (collected.whatsapp ? `WhatsApp ${collected.whatsapp}` : 'Não localizado nas fontes públicas consultadas'),
    whatsapp: collected.whatsapp || null,
    whatsappTargetHint,
    hours: collected.hours || 'Não localizado nas fontes públicas consultadas',
    locationSummary,
    productsAndServices,
    reviewsAndDifferentiators: collected.metaDescription
      ? `Resumo público obtido na fonte analisada: "${collected.metaDescription}".`
      : 'Avaliações detalhadas não acessadas automaticamente; recomenda-se incluir depoimentos reais autorizados pela empresa.',
    visualReferences:
      collected.visualReferences ||
      'Fotografias do estabelecimento não acessadas automaticamente nesta etapa. Utilizar fotos reais autorizadas pela empresa.',
    identityAndPositioning: `Identidade arquitetada para "${businessName}" (${
      collected.sourceOrigin || 'Identificação Universal'
    })${collected.cnpj ? ` · CNPJ ${collected.cnpj}` : ''}, priorizando confiança comercial, presença digital unificada e conversão direta no mobile.`,
    verifiedGoogleMapsUrl,
    website: normalizeHttpUrl(collected.website),
    instagram: normalizeHttpUrl(collected.instagram),
    facebook: normalizeHttpUrl(collected.facebook),
    linkedin: normalizeHttpUrl(collected.linkedin),
    limitations: Array.from(new Set(limitations)),
    fieldStatuses: collected.fieldStatuses || {},
    palette: buildSectorPalette(archetype),
    sectorScreens: sectorPack.screens,
    primaryCtaLabel: sectorPack.primaryCta,
    secondaryCtaLabel: sectorPack.secondaryCta,
  };
}
