<p align="center"><img src="docs/assets/flowcheck-mark.svg" width="72" height="72" alt="FlowCheck"></p>

<h1 align="center">FlowCheck Local</h1>

<p align="center">Детерминированные проверки localhost в Chromium — с evidence и MCP.</p>

FlowCheck Local запускает согласованные пользовательские сценарии в настоящем Chromium на компьютере разработчика. Результат — скриншоты, Playwright trace, JSON-отчёт и JUnit XML. Открытый runner не отправляет страницу, учётные данные или evidence в FlowCheck.

## Быстрый запуск

Требуется Node.js 22.18+ на macOS или Linux.

```bash
git clone https://github.com/kadessovb02/flowcheck.git
cd flowcheck
npm install
npx playwright install chromium
npm run quickstart
```

Команда поднимет локальный demo-сайт, заполнит форму в Chromium, проверит результат и положит evidence в `.flowcheck/runs/`.

## Собственный сценарий

```bash
npm run flowcheck -- init flowcheck.scenario.json
npm run flowcheck -- validate flowcheck.scenario.json
npm run flowcheck -- run flowcheck.scenario.json --headed
```

Поддерживаются переходы, клики, заполнение, выбор, checkbox, клавиши, ожидания и проверки текста, URL и видимости. Формат полностью описан в [документации DSL](docs/scenario-format.md).

## Что здесь открыто

- Scenario DSL и валидатор;
- deterministic Playwright runner;
- локальные evidence и JUnit;
- CLI;
- MCP-сервер для Codex, Claude Code и других клиентов.

Облачный FlowCheck — отдельный коммерческий продукт: AI-планирование, карта продукта, командные процессы, расписания и процесс «дефект → проверенный MR» не входят в этот репозиторий.

## Безопасность

Запускайте проверки только против систем, на тестирование которых у вас есть разрешение. Навигация ограничена origin из сценария. Секреты можно получать из переменных окружения, чувствительные значения не записываются в отчёт, а поля на скриншотах маскируются настроенными локаторами.

Подробности: [SECURITY.md](SECURITY.md). Лицензия: [Apache-2.0](LICENSE).
