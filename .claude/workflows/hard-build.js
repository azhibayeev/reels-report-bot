export const meta = {
  name: 'hard-build',
  description: 'Opus conductor plans and reviews, Sonnet implementers write the code; loops until the conductor has no objections left',
  whenToUse: 'Implementing an approved spec or plan when you want an Opus conductor driving Sonnet implementers with a review gate on every round',
  phases: [
    { title: 'Plan', detail: 'Opus conductor turns the spec into disjoint work items', model: 'opus' },
    { title: 'Implement', detail: 'Sonnet implementers write code and tests, one per item', model: 'sonnet' },
    { title: 'Review', detail: 'Opus reviewers check each item against its acceptance criteria', model: 'opus' },
  ],
}

// args должен приходить объектом, но передать его JSON-строкой легко, и тогда
// spread рассыпал бы строку по символам, а воркфлоу молча ушёл бы работать с
// настройками по умолчанию — то есть запустил бы полный прогон вместо заказанного.
function inputArgs() {
  if (typeof args !== 'string') return args || {}
  try {
    return JSON.parse(args)
  } catch (error) {
    throw new Error(`args пришли строкой и не разбираются как JSON: ${error.message}`)
  }
}

// ── Настройки. Всё переопределяется через args воркфлоу ────────────────────────
const cfg = {
  task: 'Реализовать одобренную спеку',
  specPath: '',              // путь к спеке/плану — агенты читают его сами
  testCommand: 'npm test',
  maxRounds: 4,
  maxItemsPerRound: 4,       // потолок ширины: соннетов за раунд
  conductorEffort: 'xhigh',
  implementerEffort: 'high',
  reviewerEffort: 'high',
  reserveTokens: 80_000,     // ниже этого остатка новый раунд не начинаем
  ...inputArgs(),
}

const PLAN_SCHEMA = {
  type: 'object',
  required: ['done', 'rationale', 'items'],
  properties: {
    done: { type: 'boolean' },
    rationale: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'files', 'instructions', 'acceptance'],
        properties: {
          label: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          instructions: { type: 'string' },
          acceptance: { type: 'string' },
        },
      },
    },
  },
}

const IMPL_SCHEMA = {
  type: 'object',
  required: ['summary', 'filesChanged', 'testsRun', 'testsPassed'],
  properties: {
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsRun: { type: 'string' },
    testsPassed: { type: 'boolean' },
    testOutputTail: { type: 'string' },
    deviations: { type: 'string' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['accepted', 'summary', 'findings'],
  properties: {
    accepted: { type: 'boolean' },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'what', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          what: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const RULES = `ЖЁСТКИЕ ПРАВИЛА, они важнее скорости:
- Следуй стилю окружающего кода: комментарии на русском и только там, где объясняют НЕОЧЕВИДНОЕ решение; никаких комментариев-подписей к очевидным строкам.
- Тесты пишутся до кода (TDD), запускаются командой ${cfg.testCommand}, и результат ты обязан привести фактически, а не пересказом.
- Не рефактори то, что не входит в твою задачу. Не переименовывай чужие символы. Не трогай файлы вне выданного тебе списка.
- Не коммить, не пушь, не создавай PR. Никаких git-операций, меняющих историю.
- Если задача сформулирована неверно или невыполнима — не имитируй выполнение. Верни это в deviations и объясни.
- Заглушки, TODO и «пока что вернём null» запрещены: либо рабочий код, либо явный отказ с причиной.`

function planPrompt(round, history) {
  const past = history.length
    ? `\n\nЧТО УЖЕ БЫЛО. Раунды по порядку, с приговорами ревьюеров:\n${JSON.stringify(history, null, 2)}`
    : '\n\nЭто первый раунд, кода по задаче ещё нет.'
  return `Ты дирижёр реализации. Задача: ${cfg.task}
${cfg.specPath ? `Спека/план: ${cfg.specPath} — прочитай её целиком перед решением.` : ''}

Твоя работа — не писать код, а разбить работу на самостоятельные задачи для исполнителей и решить, когда работа закончена.

Сначала изучи текущее состояние репозитория: что уже реализовано, что нет, что сломано. Проверяй фактами (чтение файлов, запуск ${cfg.testCommand}), а не предположениями.${past}

Верни план на ОДИН следующий раунд:
- items: до ${cfg.maxItemsPerRound} задач. Каждая — самодостаточная: исполнитель не видит ни спеку целиком, ни другие задачи, поэтому instructions должны быть исчерпывающими сами по себе.
- files: точный список файлов, которые задача имеет право менять. Списки задач НЕ должны пересекаться — пересечение заставит скрипт выполнять их последовательно и потеряет параллелизм.
- acceptance: проверяемый критерий готовности, по которому ревьюер сможет сказать «сделано» или «нет».
- done: true ТОЛЬКО если работа по спеке действительно закончена и претензий у тебя не осталось. Тогда items пустой.

Незакрытые претензии прошлых раундов ставь в items вперёд новой работы.`
}

function implPrompt(item, round) {
  return `Раунд ${round}. Ты исполнитель. Задача «${item.label}».

${item.instructions}

Критерий готовности: ${item.acceptance}

Файлы, которые тебе разрешено менять (и только они):
${item.files.map((f) => `- ${f}`).join('\n')}

${RULES}

Верни отчёт по схеме. testOutputTail — последние строки реального вывода тестов.`
}

function reviewPrompt(item, impl, round) {
  return `Раунд ${round}. Ты ревьюер, независимый от исполнителя. Проверяешь задачу «${item.label}».

Критерий готовности, который был выдан: ${item.acceptance}
Файлы задачи: ${item.files.join(', ')}
Отчёт исполнителя: ${JSON.stringify(impl)}

Не верь отчёту на слово. Прочитай изменённый код и сам запусти ${cfg.testCommand}.

Ищи именно то, что ломает работу: расхождение с критерием готовности, невыполненную часть задачи, заглушки под видом реализации, тесты, которые проходят не проверяя ничего, обработку ошибок, которой нет. Отдельно проверь, не залез ли исполнитель в файлы вне своего списка.

accepted: true только если задача действительно выполнена. Каждая находка обязана содержать fix — конкретную инструкцию, что сделать, а не «переписать лучше».`
}

// Волны: внутри волны списки файлов не пересекаются, значит задачи можно писать
// параллельно. Пересекающиеся уезжают в следующую волну — иначе два соннета
// затрут друг другу правки в одном файле.
function waves(items) {
  const out = []
  for (const item of items) {
    const files = new Set(item.files || [])
    let placed = false
    for (const wave of out) {
      const clash = wave.some((other) => (other.files || []).some((f) => files.has(f)))
      if (!clash) {
        wave.push(item)
        placed = true
        break
      }
    }
    if (!placed) out.push([item])
  }
  return out
}

// ── Прогон ────────────────────────────────────────────────────────────────────
const history = []
let round = 0
let closedBy = 'maxRounds'
let lastRationale = ''

while (round < cfg.maxRounds) {
  if (budget.total && budget.remaining() < cfg.reserveTokens) {
    closedBy = 'budget'
    log(`Остаток бюджета ${Math.round(budget.remaining() / 1000)}k — новый раунд не начинаю`)
    break
  }

  round += 1
  phase('Plan')
  const plan = await agent(planPrompt(round, history), {
    label: `conductor:r${round}`,
    phase: 'Plan',
    model: 'opus',
    effort: cfg.conductorEffort,
    schema: PLAN_SCHEMA,
  })

  if (!plan) {
    closedBy = 'conductor-lost'
    log(`Раунд ${round}: дирижёр не вернул план — останавливаюсь`)
    break
  }

  lastRationale = plan.rationale
  if (plan.done || !plan.items.length) {
    closedBy = 'conductor-done'
    log(`Раунд ${round}: дирижёр закрыл работу — ${plan.rationale}`)
    break
  }

  const items = plan.items.slice(0, cfg.maxItemsPerRound)
  if (plan.items.length > items.length) {
    log(`Раунд ${round}: дирижёр дал ${plan.items.length} задач, беру ${items.length} — потолок maxItemsPerRound, остальные вернутся следующим раундом`)
  }

  const groups = waves(items)
  if (groups.length > 1) {
    log(`Раунд ${round}: ${items.length} задач разведены на ${groups.length} волн — у некоторых пересекаются файлы`)
  }

  // Реализация и ревью идут парой по каждой задаче: ревьюер стартует сразу, как
  // его исполнитель закончил, и не ждёт соседей по волне.
  const done = []
  for (const wave of groups) {
    const pairs = await pipeline(
      wave,
      (item) =>
        agent(implPrompt(item, round), {
          label: `impl:${item.label}`,
          phase: 'Implement',
          model: 'sonnet',
          effort: cfg.implementerEffort,
          schema: IMPL_SCHEMA,
        }),
      (impl, item) =>
        impl
          ? agent(reviewPrompt(item, impl, round), {
              label: `review:${item.label}`,
              phase: 'Review',
              model: 'opus',
              effort: cfg.reviewerEffort,
              schema: REVIEW_SCHEMA,
            }).then((review) => ({ item, impl, review }))
          : { item, impl: null, review: null }
    )
    done.push(...pairs.filter(Boolean))
  }

  const lost = done.filter((d) => !d.impl).map((d) => d.item.label)
  if (lost.length) log(`Раунд ${round}: без результата остались ${lost.join(', ')}`)

  history.push({
    round,
    items: done.map((d) => ({
      label: d.item.label,
      files: d.item.files,
      implemented: Boolean(d.impl),
      testsPassed: d.impl ? d.impl.testsPassed : false,
      deviations: d.impl ? d.impl.deviations : null,
      accepted: d.review ? d.review.accepted : null,
      findings: d.review ? d.review.findings : [],
    })),
  })

  const open = history[history.length - 1].items.flatMap((i) => i.findings || [])
  const blockers = open.filter((f) => f.severity === 'blocker').length
  log(`Раунд ${round}: задач ${done.length}, принято ${history[history.length - 1].items.filter((i) => i.accepted).length}, находок ${open.length} (блокеров ${blockers})`)
}

return {
  rounds: round,
  closedBy,
  conductorRationale: lastRationale,
  converged: closedBy === 'conductor-done',
  history,
  openFindings: history.flatMap((r) => r.items.flatMap((i) => (i.findings || []).map((f) => ({ round: r.round, item: i.label, ...f })))),
}
