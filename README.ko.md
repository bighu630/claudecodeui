<div align="center">
  <img src="public/logo.svg" alt="CodeAgent UI" width="64" height="64">
  <h1>CodeAgent UI (일명 Claude Code UI)</h1>
  <p><a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>, <a href="https://docs.cursor.com/en/cli/overview">Cursor CLI</a>, <a href="https://developers.openai.com/codex">Codex</a>, <a href="https://geminicli.com/">Gemini-CLI</a> 용 데스크톱 및 모바일 UI입니다.<br>로컬 또는 원격에서 실행하여 어디서나 활성 프로젝트와 세션을 확인하세요.</p>
</div>
<div align="right"><i><a href="./README.md">English</a> · <a href="./README.ru.md">Русский</a> · <a href="./README.de.md">Deutsch</a> · <b>한국어</b> · <a href="./README.zh-CN.md">中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.tr.md">Türkçe</a></i></div>

---
## 역할 기반 세션 시스템

CodeAgent UI는 역할 기반 세션 시스템을 사용하여 복잡한 에이전트 워크플로를 관리합니다. 각 프로젝트는 생성 시 두 개의 루트 세션 트리를 자동으로 부트스트랩하며, 세션은 엄격한 부모-자식 파생 계층 구조를 따릅니다.

### 세션 트리 구조

각 프로젝트는 두 개의 독립적인 루트 세션으로 부트스트랩됩니다:

- **tech_lead** — 아키텍처 결정, 타당성 분석, 요구 사항 분해를 담당합니다. 구현 작업을 feature_lead 세션에 위임합니다.
- **ops** — 배포, 환경 구성, 인프라 지원을 관리합니다. 이 루트는 독립적이며 자식 세션을 생성하지 않습니다.

허용되는 파생 관계:

- `tech_lead → feature_lead` — tech_lead 세션이 feature_lead 자식 세션을 생성 가능
- `feature_lead → worker` — feature_lead 세션이 worker 자식 세션을 생성 가능
- `worker → ✗` — worker는 실행 전용이며 더 이상 세션을 생성 불가
- `ops → ✗` — ops 세션은 독립적으로 운영

### 역할 책임

| 역할 | 책임 |
|---|---|
| **tech_lead** | 아키텍처 결정, 타당성 평가, 요구 사항 분석. 작업을 feature_lead에 전달합니다. |
| **feature_lead** | 코드 수준 계획, 구현 분해, worker 조정. |
| **worker** | 작업 명세서를 엄격히 따릅니다. 단일 책임. |
| **ops** | 배포, 환경, 인프라 지원. |

### 빈 상태 시작 전략

자식 세션은 빈 상태로 시작하며 필요한 최소한의 핸드오프 컨텍스트(목표, 제약 조건, 작업 명세서)만 수신합니다. 세션 기록은 부모로부터 **상속되지 않습니다**. 이는 역할 누수를 방지합니다. worker는 자신에게 할당된 작업에 대해서만 실행하며, 해당 작업을 생성한 전체 대화 내용에 영향을 받지 않습니다.

### 세션과 런타임 분리

오케스트레이터 세션은 세션 트리 내의 **논리적 아이덴티티**이며, 공급자 런타임(Claude, Codex, Cursor 또는 Gemini 세션)은 **실행 캐리어**입니다. 이들은 다른 개념입니다. 하나의 오케스트레이터 세션은 `external_session_id`를 통해 하나의 런타임 세션에 바인딩될 수 있지만, 트리 구조, 역할 프롬프트, 라이프사이클은 런타임 공급자와 독립적으로 관리됩니다.

## 스크린샷

<div align="center">

<table>
<tr>
<td align="center">
<h3>데스크톱 보기</h3>
<img src="public/screenshots/desktop-main.png" alt="데스크톱 인터페이스" width="400">
<br>
<em>프로젝트 개요와 채팅을 보여주는 메인 인터페이스</em>
</td>
<td align="center">
<h3>모바일 경험</h3>
<img src="public/screenshots/mobile-chat.png" alt="모바일 인터페이스" width="250">
<br>
<em>터치 내비게이션이 포함된 반응형 모바일 디자인</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI 선택</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI 선택" width="400">
<br>
<em>Claude Code, Gemini, Cursor CLI 및 Codex 중 선택</em>
</td>
</tr>
</table>

</div>

## 기능

- **반응형 디자인** - 데스크톱, 태블릿, 모바일을 아우르는 매끄러운 경험으로 어디서든 Agents를 사용할 수 있습니다
- **대화형 채팅 인터페이스** - 내장된 채팅 UI를 통해 에이전트와 자연스럽게 소통
- **통합 셸 터미널** - 셸 기능을 통해 Agents CLI에 직접 접근
- **파일 탐색기** - 구문 강조 및 실시간 편집을 갖춘 인터랙티브 파일 트리
- **Git 탐색기** - 변경 사항 보기, 스테이징 및 커밋. 브랜치 전환 기능 포함
- **세션 관리** - 대화를 재개하고, 여러 세션을 관리하며 기록을 추적
- **플러그인 시스템** - 커스텀 탭, 백엔드 서비스, 통합을 추가하여 CodeAgent 확장. [직접 빌드 →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)
- **TaskMaster AI 통합** *(선택사항)* - AI 중심의 작업 계획, PRD 파싱, 워크플로 자동화를 통한 고급 프로젝트 관리
- **모델 호환성** - Claude, GPT, Gemini 모델 계열에서 작동 (`shared/modelConstants.js`에서 전체 지원 모델 확인)

## 빠른 시작

### CodeAgent Cloud (추천)

가장 빠르게 시작하는 방법 — 로컬 설정 없이도 가능합니다. 웹, 모바일 앱, API 또는 선호하는 IDE에서 이용할 수 있는 완전 관리형 컨테이너화된 개발 환경을 제공합니다.

**[CodeAgent Cloud 시작하기](https://github.com/bighu630/claudecodeui)**

### 셀프 호스트 (오픈 소스)

#### npm

**npx**로 즉시 CodeAgent UI를 실행하세요 (Node.js v22+ 필요):

```bash
npx @codeagent-ui/codeagent
```

**정기적으로 사용한다면 전역 설치:**

```bash
npm install -g @codeagent-ui/codeagent
codeagent
```

`http://localhost:3001`을 열면 기존 세션이 자동으로 발견됩니다.

자세한 구성 옵션, PM2, 원격 서버 설정 등은 **[문서 →](https://github.com/bighu630/claudecodeui)**를 참고하세요.

#### Docker Sandboxes (실험적)

하이퍼바이저 수준 격리로 에이전트를 샌드박스에서 실행합니다. 기본 에이전트는 Claude Code입니다. [`sbx` CLI](https://docs.docker.com/ai/sandboxes/get-started/)가 필요합니다.

```
npx @codeagent-ui/codeagent@latest sandbox ~/my-project
```

Claude Code, Codex, Gemini CLI를 지원합니다. 자세한 내용은 [샌드박스 문서](docker/)를 참고하세요.

---
## 어느 옵션이 적합한가요?

CodeAgent UI는 CodeAgent Cloud를 구동하는 오픈 소스 UI 계층입니다. 로컬 머신에서 직접 셀프 호스트하거나, CodeAgent Cloud(완전 관리형 클라우드 환경, 팀 기능, 심화 통합 제공)를 사용할 수 있습니다.

| | CodeAgent UI (셀프 호스트) | CodeAgent Cloud |
|---|---|---|
| **적합한 대상** | 로컬 에이전트 세션을 위한 전체 UI가 필요한 개발자 | 어디서든 접근 가능한 클라우드에서 에이전트를 운영하고자 하는 팀 및 개발자 |
| **접근 방법** | `[yourip]:port`를 통해 브라우저 접속 | 브라우저, IDE, REST API, n8n |
| **설정** | `npx @codeagent-ui/codeagent` | 설정 불필요 |
| **기기 유지 필요 여부** | 예 (머신 켜둬야 함) | 아니오 |
| **모바일 접근** | 네트워크 내 브라우저 | 모든 기기 (네이티브 앱 예정) |
| **세션 접근** | `~/.claude`에서 자동 발견 | 클라우드 환경 내 세션 |
| **지원 에이전트** | Claude Code, Cursor CLI, Codex, Gemini CLI | Claude Code, Cursor CLI, Codex, Gemini CLI |
| **파일 탐색기 및 Git** | UI에 통합됨 | UI에 통합됨 |
| **MCP 구성** | UI에서 관리, 로컬 `~/.claude` 설정과 동기화됨 | UI에서 관리 |
| **IDE 접근** | 로컬 IDE | 클라우드 환경에 연결된 모든 IDE |
| **REST API** | 예 | 예 |
| **n8n 노드** | 아니오 | 예 |
| **팀 공유** | 아니오 | 예 |
| **플랫폼 비용** | 무료, 오픈 소스 | 월 $7부터 |

> 둘 다 자체 AI 구독(Claude, Cursor 등)을 그대로 사용합니다 — CodeAgent는 환경만 제공합니다.

---
## 보안 및 도구 구성

**🔒 중요 공지**: 모든 Claude Code 도구는 **기본적으로 비활성화**되어 있습니다. 이는 잠재적인 유해 작업이 자동 실행되는 것을 방지하기 위한 조치입니다.

### 도구 활성화

1. **도구 설정 열기** - 사이드바의 톱니바퀴 아이콘 클릭
2. **선택적으로 활성화** - 필요한 도구만 켜기
3. **설정 적용** - 선호도는 로컬에 저장됨

<div align="center">

![도구 설정 모달](public/screenshots/tools-modal.png)
*도구 설정 인터페이스 - 필요한 것만 켜세요*

</div>

**권장 방법**: 기본 도구를 먼저 켜고 필요할 때 추가하세요. 언제든지 조정 가능합니다.

---
## 플러그인

CodeAgent는 커스텀 탭과 선택적 Node.js 백엔드가 포함된 플러그인 시스템을 제공합니다. Settings > Plugins에서 Git 저장소에서 플러그인을 설치하거나 직접 빌드할 수 있습니다.

### 이용 가능한 플러그인

| 플러그인 | 설명 |
|---|---|
| **[Project Stats](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** | 현재 프로젝트의 파일 수, 코드 줄 수, 파일 유형 분포, 가장 큰 파일, 최근 수정 파일을 표시 |

### 직접 만들기

**[Plugin Starter Template →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** — 이 저장소를 포크하여 플러그인 구축. 프런트엔드 렌더링, 실시간 컨텍스트 업데이트, RPC 통신 예제 포함.

**[플러그인 문서 →](https://github.com/bighu630/claudecodeui/plugin-overview)** — 플러그인 API, 매니페스트 포맷, 보안 모델 등을 설명.

---
## FAQ

<details>
<summary>Claude Code Remote Control과 어떻게 다른가요?</summary>

Claude Code Remote Control은 이미 로컬 터미널에서 실행 중인 세션으로 메시지를 전송합니다. 이 경우 기계가 켜져 있어야 하고 터미널을 열어 둬야 하며, 네트워크 연결 없이 약 10분 후 타임아웃됩니다.

CodeAgent UI와 CodeAgent Cloud는 Claude Code를 확장하며 별도로 존재하지 않습니다 — MCP 서버, 권한, 설정, 세션은 Claude Code에서 그대로 사용됩니다.

- **모든 세션을 다룬다** — CodeAgent UI는 `~/.claude` 폴더에서 모든 세션을 자동 발견합니다. Remote Control은 단일 활성 세션만 노출합니다.
- **설정은 그대로** — CodeAgent UI에서 변경한 MCP, 도구 권한, 프로젝트 설정은 Claude Code에 즉시 반영됩니다.
- **지원 에이전트가 더 많음** — Claude Code, Cursor CLI, Codex, Gemini CLI 지원.
- **전체 UI 제공** — 단일 채팅 창이 아닌 파일 탐색기, Git 통합, MCP 관리 및 셸 터미널 포함.
- **CodeAgent Cloud는 클라우드에서 실행** — 노트북을 닫아도 에이전트가 실행됩니다. 터미널을 계속 확인할 필요 없음.

</details>

<details>
<summary>AI 구독을 별도로 결제해야 하나요?</summary>

네. CodeAgent는 환경만 제공합니다. Claude, Cursor, Codex, Gemini 구독 비용은 별도로 부과됩니다. CodeAgent Cloud는 관리형 환경을 월 $7부터 제공합니다.

</details>

<details>
<summary>CodeAgent UI를 휴대폰에서 사용할 수 있나요?</summary>

네. 셀프 호스트인 경우 기계에서 서버를 실행하고 네트워크의 아무 브라우저에서 `[yourip]:port`를 열면 됩니다. CodeAgent Cloud는 어떤 기기에서도 열 수 있으며, 네이티브 앱도 준비 중입니다.

</details>

<details>
<summary>UI에서 변경하면 로컬 Claude Code 설정에 영향을 주나요?</summary>

네, 셀프 호스트에서는 그렇습니다. CodeAgent UI는 Claude Code가 사용하는 동일한 `~/.claude` 설정을 읽고 씁니다. UI에서 추가한 MCP 서버가 Claude Code에 즉시 나타납니다.

</details>

---
## 커뮤니티 및 지원

- **[문서](https://github.com/bighu630/claudecodeui)** — 설치, 구성, 기능, 문제 해결 안내
- **[GitHub Issues](https://github.com/bighu630/claudecodeui/issues)** — 버그 보고 및 기능 요청
- **[기여 안내](CONTRIBUTING.md)** — 프로젝트 참여 방법

## 라이선스

GNU General Public License v3.0 - 자세한 내용은 [LICENSE](LICENSE) 파일 참조.

이 프로젝트는 GPL v3 라이선스 하에 오픈 소스로 공개되어 있으며 자유롭게 사용, 수정, 배포할 수 있습니다.

## 감사의 말

### 사용 기술
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic 공식 CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor 공식 CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[Gemini-CLI](https://geminicli.com/)** - Google Gemini CLI
- **[React](https://react.dev/)** - 사용자 인터페이스 라이브러리
- **[Vite](https://vitejs.dev/)** - 빠른 빌드 도구 및 개발 서버
- **[Tailwind CSS](https://tailwindcss.com/)** - 유틸리티 우선 CSS 프레임워크
- **[CodeMirror](https://codemirror.net/)** - 고급 코드 에디터
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(선택사항)* - AI 기반 프로젝트 관리 및 작업 계획

### 스폰서
---