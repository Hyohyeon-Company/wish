# wish 컨테이너 런북

wish API(`apps/server`, NestJS)를 Docker Compose로 기동·정지·확인하는 절차다.
구성 정의는 저장소 루트의 `docker-compose.yml`, 이미지 정의는
`apps/server/Dockerfile`에 있다.

- 이미지: 멀티스테이지(pnpm 설치 → `tsc` 빌드 → 프로덕션 의존성만), `node:24-alpine`
  고정, 비루트 사용자 `wish`(uid/gid 10001), `EXPOSE 3000`
- 서비스: `api` 1개. DB 서비스는 없다.
- 헬스체크: `GET /api/categories`가 HTTP 200을 반환할 때 `healthy`
- 접속: 호스트 `WISH_API_PORT`(기본 3000) → 컨테이너 3000

## 1. 기동

```bash
# 저장소 루트에서
docker compose up -d --build
docker compose ps                  # STATUS가 healthy가 될 때까지 확인
docker compose logs -f api         # "wish API listening on port 3000" 확인
```

`docker compose ps`의 `STATUS`가 `Up (healthy)`이면 기동 완료다. `starting`에서
`healthy`로 바뀌지 않으면 5장의 확인 순서를 따른다.

포트를 바꾸려면 환경 변수로 호스트 포트만 바꾼다.

```bash
WISH_API_PORT=4000 docker compose up -d
curl -s http://127.0.0.1:4000/api/categories | head -c 200
```

컨테이너 내부 포트는 항상 3000이고 `PORT` 환경 변수도 3000으로 고정되어 있다.
호스트 포트만 매핑이 바뀐다.

## 2. API 흐름 스모크

```bash
node scripts/api-flow-smoke.mjs
WISH_BASE_URL=http://127.0.0.1:4000 node scripts/api-flow-smoke.mjs
```

의존성 없는 Node 24 ESM 스크립트다. 12단계(카테고리 → 가입 → me → 상품 등록 →
목록 → 상세 → 찜 → 찜 해제 → 내 상품 → 상태 변경 → 삭제 → 로그아웃/토큰 무효화)를
순서대로 실행하고, 각 단계의 상태 코드와 필수 필드를 단언한다. 실패하면 즉시
`exit 1`, 마지막에는 JSON 요약(단계별 상태·기대값·실패 사유)을 출력한다. 토큰 값은
출력하지 않는다.

## 3. 정지·재기동·로그

```bash
docker compose stop            # 컨테이너만 정지 (재시작 정책 유지)
docker compose start           # 정지한 컨테이너 재기동
docker compose restart api     # 프로세스 재시작
docker compose logs --tail=200 api
docker compose down            # 컨테이너·네트워크 제거 (이미지는 남는다)
docker compose down --rmi local   # 로컬 이미지까지 제거
```

## 4. 재기동 시 데이터 소실 (중요)

현재 wish API는 **인메모리 저장소**(`in-memory-member.repository.ts`,
`in-memory-product.repository.ts`, `in-memory-favorite.repository.ts`)를 쓴다.
DB도 마이그레이션도 없으므로 다음은 모두 데이터를 잃는다.

- `docker compose restart api`
- `docker compose down` 후 `up`
- 이미지 재빌드 후 재기동
- 컨테이너가 비정상 종료되어 재시작 정책으로 다시 뜨는 경우

즉 스모크 테스트가 만든 회원·상품·찜은 재기동 후 존재하지 않는다. 스모크
스크립트는 매 실행마다 새 이메일로 가입하므로 반복 실행해도 충돌하지 않는다.

업로드 이미지도 컨테이너 파일시스템의 `UPLOAD_DIR`(기본
`/app/apps/server/data/uploads`)에만 저장되므로 컨테이너를 제거하면 함께 사라진다.
지속이 필요한 시나리오는 아직 지원하지 않는다(볼륨을 붙이면 파일만 남고 이를
참조하는 상품 데이터는 사라져 고아 파일이 된다). 영속 저장소 도입은 별도
슬라이스다.

## 5. 기동 실패 시 확인 순서

1. **빌드 실패** — `docker compose build api`를 직접 실행해 로그 확인.
   - `ERR_PNPM_OUTDATED_LOCKFILE`: `pnpm-lock.yaml`과 워크스페이스 매니페스트가
     어긋난 상태다. 저장소에서 `pnpm install` 후 락파일 변경을 커밋해야 한다.
   - `engines` 불일치: 이미지 Node 버전이 `>=24 <25`를 벗어났는지 확인한다.
2. **컨테이너가 계속 재시작** — `docker compose logs api`에서 스택 트레이스 확인.
   포트 바인딩 오류라면 호스트에서 이미 3000을 쓰는 프로세스가 있는지 확인하고
   `WISH_API_PORT`를 바꾼다.
3. **`permission denied` / `ERR_INVALID_PACKAGE_CONFIG`** — 컨테이너가 시작 직후
   `ExitCode=1`로 재시작을 반복하고 로그에
   `Cannot read package config /app/package.json: permission denied`가 보이면,
   이미지 안 매니페스트 모드가 비루트 사용자 `wish`(10001)에게 읽히지 않는 상태다.
   원인은 `COPY`가 빌드 컨텍스트의 파일 모드를 그대로 상속하기 때문이다. 체크아웃
   호스트의 umask가 0077이면 `package.json`·`apps/server/package.json` 등이
   이미지에 `0600 root:root`로 들어간다(정상 정의는 `COPY --chmod=644`로 모드를
   정규화하므로 이 증상이 나오지 않는다).

   이미지 안 모드부터 확인한다.
   ```bash
   docker run --rm --entrypoint sh wish-api:local -c 'ls -l /app/package.json'
   # 0600 root:root  ⇒ 원인 확정 (0644여야 정상)
   ```

   조치: `apps/server/Dockerfile`의 매니페스트 `COPY`(빌드 단계·런타임 단계 모두)에
   `--chmod=644`가 있는지 확인하고, 없으면 추가한 뒤 `docker compose build --no-cache api`
   로 다시 빌드한다. **호스트 체크아웃을 `chmod`로 고치는 것은 해결이 아니다** —
   이미지가 자기 모드를 보장해야 다른 클론·CI에서도 기동한다.
4. **`unhealthy`** — 컨테이너 안에서 직접 확인한다.
   ```bash
   docker compose exec api node -e "fetch('http://127.0.0.1:3000/api/categories').then(r=>{console.log(r.status);process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"
   ```
   200이 아님이 확인되면 `docker compose logs api`에서 라우팅·모듈 초기화 오류를
   본다.
5. **업로드 실패(권한)** — `UPLOAD_DIR`이 비루트 사용자 `wish` 소유인지 확인한다.
   ```bash
   docker compose exec api ls -ld /app/apps/server/data/uploads
   ```
6. **이미지 pull 실패** — 네트워크 또는 레지스트리 접근 문제다. 추측으로 베이스
   이미지를 바꾸지 말고, 사용 가능한 이미지/프록시를 확인한 뒤 근거를 남긴다.

## 6. 에이전트·CI 세션이 docker 그룹에 없을 때

셸 사용자가 `docker` 그룹에 속하지 않으면 `permission denied while trying to
connect to the Docker daemon socket`이 발생한다. 이때는 해당 환경이 제공하는
승인된 래퍼를 통해 실행한다(예: `sg docker -c 'docker compose ps'`). 새 그룹
멤버십은 이미 실행 중인 프로세스에 적용되지 않으므로 세션 재시작이 필요하다.

## 7. 범위 밖

- `apps/web` 정적 자산 서빙은 이 구성에 포함되지 않는다(별도 배포 결정).
- DB·마이그레이션·백업은 인메모리 슬라이스가 끝난 뒤의 작업이다.
- 운영 배포·모니터링은 이 런북의 대상이 아니다.
