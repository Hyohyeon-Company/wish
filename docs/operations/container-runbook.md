# wish 컨테이너 런북

wish API(`apps/server`, NestJS)와 MySQL을 Docker Compose로 기동·정지·확인하고,
마이그레이션·시드·데이터 유지를 확인하는 절차다. 구성 정의는 저장소 루트의
`docker-compose.yml`, 이미지 정의는 `apps/server/Dockerfile`에 있다.

- 이미지: 멀티스테이지(pnpm 설치 → `tsc` 빌드 → 프로덕션 의존성만), `node:24-alpine`
  고정, 비루트 사용자 `wish`(uid/gid 10001), `EXPOSE 3000`
- 서비스: `api` 1개 + `mysql` 1개(`mysql:8.4`)
- 저장소 선택: `WISH_STORAGE` — compose는 `mysql`(기본값), 애플리케이션 코드 기본값은
  `memory`(기존 테스트·로컬 실행 그대로)
- 헬스체크: `api`는 `GET /api/categories` HTTP 200, `mysql`은 `mysqladmin ping`
- 접속: 호스트 `WISH_API_PORT`(기본 3000) → 컨테이너 3000. MySQL은 호스트 포트를
  열지 않는다(compose 네트워크 내부 전용).
- 데이터: `wish-mysql-data` named volume

## 1. 기동

```bash
# 저장소 루트에서
docker compose up -d --build
docker compose ps                  # api가 healthy, mysql이 healthy가 될 때까지 확인
docker compose logs -f api         # "wish storage: mysql mysql:3306/wish ..." 확인
```

`api`는 `mysql`이 healthy가 된 뒤에 시작한다. 기동 로그에 다음 두 줄이 순서대로
보이면 정상이다.

```text
wish storage: mysql mysql:3306/wish (migrations applied: 0001)
wish API listening on port 3000
```

`migrations applied: none`은 이미 적용된 스키마를 재사용했다는 뜻이다(정상).

포트를 바꾸려면 환경 변수로 호스트 포트만 바꾼다.

```bash
WISH_API_PORT=4000 docker compose up -d
curl -s http://127.0.0.1:4000/api/categories | head -c 200
```

컨테이너 내부 포트는 항상 3000이고 `PORT` 환경 변수도 3000으로 고정되어 있다.
호스트 포트만 매핑이 바뀐다. 로컬 자격 증명 기본값은 `docker-compose.yml`에 있고,
`.env.example`을 `.env`로 복사해 덮어쓸 수 있다.

## 2. 마이그레이션

스키마는 `db/migrations/<버전>_<이름>.sql` 버전 파일이고, 적용 이력은
`schema_migrations` 테이블(버전·파일 체크섬·적용 시각)에 남는다. 실행 경로는 두 가지다.

1. **API 기동 시 자동** — `WISH_STORAGE=mysql`이면 라우터가 열리기 전에 미적용
   마이그레이션만 순서대로 적용한다. 실패하면 API는 기동하지 않는다.
2. **수동 실행** — 적용 상태를 확인하거나 배포 전에 미리 적용한다.

```bash
docker compose exec api node dist/db/migrate.js
# 또는 이미지 밖에서: pnpm --filter @wish/server build && WISH_STORAGE=mysql \
#   WISH_DB_HOST=127.0.0.1 pnpm --filter @wish/server db:migrate
```

출력은 JSON이다(`target`, `known`, `applied`, `upToDate`). 알아둘 동작:

- 이미 적용된 버전은 다시 실행하지 않는다.
- 적용된 파일이 나중에 수정되면 **체크섬 불일치로 거부**한다. 스키마를 바꾸려면
  기존 파일을 고치지 말고 새 버전 파일을 추가한다.
- DB에 이 빌드가 모르는 버전이 있으면(스키마가 코드보다 앞섬) 거부한다.
  이미지와 DB 버전을 맞춘 뒤 다시 실행한다.
- MySQL DDL은 트랜잭션으로 묶이지 않는다. 마이그레이션 문장은 재실행 가능하게
  작성되어 있지만(`CREATE TABLE IF NOT EXISTS`, `ON DUPLICATE KEY UPDATE`), 실패 시
  로그의 `statement n/m`을 보고 실제 스키마 상태를 확인한다.

## 3. 시드 (데모 데이터)

카테고리 5종과 상태 전이표는 스키마 마이그레이션의 고정 참조 데이터다. 데모 회원
1명과 상품 12건은 별도 시드로, **자동 실행되지 않는다**.

```bash
docker compose exec api node dist/db/seed.js
# 출력: {"target":"mysql:3306/wish","seedDir":"/app/db/seed","file":"demo.sql","statements":3,...}
```

- 고정 UUID를 쓰므로 여러 번 실행해도 중복 상품이 생기지 않는다(재실행은 no-op).
- 데모 판매자 계정: `demo-seller@wish.local` / `demo-pass-1234`.
- 데모 상품 이미지는 외부 플레이스홀더 URL이다. 실제 사진으로 보려면 앱에서
  `POST /api/uploads`로 업로드한 URL을 사용한다.
- 시드는 전체가 한 트랜잭션이라 문장 하나가 실패하면 아무것도 반영되지 않는다.

## 4. 재기동 후 데이터 유지 확인 (완료 기준 확인 절차)

```bash
# 1) 회원 1명 + 상품 1건을 API로 만든다
curl -s -X POST http://127.0.0.1:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"keep@example.com","password":"Str0ng-Pass!","nickname":"유지확인","region":"서울"}'
#    응답의 token과 member.id를 기록한다 (SHELL 변수에 저장)

curl -s -X POST http://127.0.0.1:3000/api/products \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"재기동 확인 상품","price":1000,"category_code":"furniture","condition":"used","description":"재기동 후에도 남아야 합니다.","region":"서울","image_urls":["https://picsum.photos/seed/keep/640/480"]}'

# 2) DB에 실제로 들어갔는지 확인
docker compose exec mysql \
  mysql -u"$WISH_DB_USER" -p"$WISH_DB_PASSWORD" "$WISH_DB_NAME" \
  -e "SELECT COUNT(*) AS members FROM members; SELECT COUNT(*) AS products FROM products;"

# 3) API 재기동 후 다시 조회
docker compose restart api
sleep 5
curl -s 'http://127.0.0.1:3000/api/products?q=재기동' | head -c 300
#    → 같은 상품이 계속 보이면 유지 확인 성공
```

`down` 후 다시 `up` 해도 volume이 남아 있으면 데이터는 유지된다.

```bash
docker compose down          # 컨테이너·네트워크만 제거, 데이터 유지
docker compose up -d
docker compose down -v       # 주의: volume까지 제거 = 데이터 삭제
```

세션 토큰은 프로세스 메모리에 있으므로 `restart` 후에는 이전 토큰이 무효가 된다
(회원·상품·찜 데이터는 유지된다). 확인 절차에서 재로그인하거나 새로 가입한다.

## 5. API 흐름 스모크

```bash
node scripts/api-flow-smoke.mjs
WISH_BASE_URL=http://127.0.0.1:4000 node scripts/api-flow-smoke.mjs
```

의존성 없는 Node 24 ESM 스크립트다. 12단계(카테고리 → 가입 → me → 상품 등록 →
목록 → 상세 → 찜 → 찜 해제 → 내 상품 → 상태 변경 → 삭제 → 로그아웃/토큰 무효화)를
순서대로 실행하고, 각 단계의 상태 코드와 필수 필드를 단언한다. 실패하면 즉시
`exit 1`, 마지막에는 JSON 요약(단계별 상태·기대값·실패 사유)을 출력한다. 토큰 값은
출력하지 않는다. 매 실행마다 새 이메일로 가입하므로 반복 실행해도 충돌하지 않는다.

## 6. 정지·재기동·로그

```bash
docker compose stop            # 컨테이너만 정지 (재시작 정책 유지)
docker compose start           # 정지한 컨테이너 재기동
docker compose restart api     # 프로세스 재시작 (데이터 유지, 세션 토큰 무효)
docker compose logs --tail=200 api
docker compose logs --tail=200 mysql
docker compose down            # 컨테이너·네트워크 제거 (이미지·볼륨은 남는다)
docker compose down -v         # 볼륨까지 제거 (데이터 삭제)
docker volume ls | grep wish   # 볼륨 확인
```

## 7. 기동 실패 시 확인 순서

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
   정규화하므로 이 증상이 나오지 않는다). `db/` 트리도 같은 이유로 `chmod -R a+rX`로
   정규화한다.

   이미지 안 모드부터 확인한다.
   ```bash
   docker run --rm --entrypoint sh wish-api:local -c 'ls -l /app/package.json /app/db/migrations'
   # 0600 root:root  ⇒ 원인 확정 (0644/0755여야 정상)
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
5. **`wish API failed to start: ... MySQL at mysql:3306/wish is not reachable`** —
   `WISH_STORAGE=mysql`인데 DB에 연결하지 못한 상태다. API는 인메모리로 폴백하지
   않고 종료한다(의도된 동작). 확인 순서:
   ```bash
   docker compose ps mysql                  # healthy인가
   docker compose logs mysql | tail -50     # 초기화 오류·권한 오류
   docker compose exec mysql mysqladmin -u"$WISH_DB_USER" -p"$WISH_DB_PASSWORD" ping
   ```
   자격 증명을 바꿨다면 **볼륨 초기화가 필요하다** — `MYSQL_USER`/`MYSQL_PASSWORD`는
   볼륨이 비어 있을 때만 적용된다. 로컬 데이터를 버려도 되면 `docker compose down -v`
   후 다시 올린다.
6. **`wish API failed to start: migration 0001 (initial_schema) failed on statement n/m: ...`**
   — 마이그레이션 실행 오류다. 메시지의 `statement n/m`에서 실패 지점을 확인한다.
   - `changed after it was applied`: 적용된 파일을 수정했다. 파일을 되돌리거나 새 버전
     파일로 변경한다.
   - `database schema is ahead of this build`: DB에 더 새로운 마이그레이션이 적용되어
     있다. 이미지를 최신 main으로 다시 빌드한다.
7. **업로드 실패(권한)** — `UPLOAD_DIR`이 비루트 사용자 `wish` 소유인지 확인한다.
   ```bash
   docker compose exec api ls -ld /app/apps/server/data/uploads
   ```
8. **이미지 pull 실패** — 네트워크 또는 레지스트리 접근 문제다. 추측으로 베이스
   이미지를 바꾸지 말고, 사용 가능한 이미지/프록시를 확인한 뒤 근거를 남긴다.

## 8. 저장소 모드를 바꿔서 띄우기

인메모리 동작(재기동 시 데이터 소실)을 확인해야 할 때만 쓴다.

```bash
WISH_STORAGE=memory docker compose up -d api
docker compose logs -f api      # "wish storage: mysql ..." 로그가 없어야 정상
```

이 모드에서는 `mysql` 서비스가 계속 떠 있어도 API가 접속하지 않으며, 재기동하면
회원·상품·찜이 모두 사라진다. 기본값으로 되돌리려면 `WISH_STORAGE`를 비우고
`docker compose up -d`를 다시 실행한다.

`WISH_STORAGE`에 `mysql`/`memory` 이외의 값이 들어가면 API는 기동하지 않고
`WISH_STORAGE must be one of memory|mysql, got "..."`로 실패한다.

## 9. 알려진 한계 (v1)

- **세션 토큰은 프로세스 메모리**에 있다. 재기동하면 로그아웃 상태가 되고, 여러
  인스턴스로 늘리면 토큰이 공유되지 않는다. 세션 저장소의 DB 이관은 후속 슬라이스다.
- **업로드 이미지는 컨테이너 파일시스템**에 남는다. 컨테이너를 제거하면 사라지고
  (`down -v`와 무관), 상품 데이터가 남아 있어도 사진은 없어진다. 볼륨 분리는 후속
  슬라이스다.
- 데모 시드 이미지는 외부 플레이스홀더 URL이며 오프라인 환경에서는 표시되지 않는다.
- 백업·복구, 운영 배포·모니터링은 이 런북의 범위가 아니다.

## 10. 에이전트·CI 세션이 docker 그룹에 없을 때

셸 사용자가 `docker` 그룹에 속하지 않으면 `permission denied while trying to
connect to the Docker daemon socket`이 발생한다. 이때는 해당 환경이 제공하는
승인된 래퍼를 통해 실행한다(예: `sg docker -c 'docker compose ps'`). 새 그룹
멤버십은 이미 실행 중인 프로세스에 적용되지 않으므로 세션 재시작이 필요하다.

## 11. 범위 밖

- `apps/web` 정적 자산 서빙은 이 구성에 포함되지 않는다(별도 배포 결정).
- 운영 배포·모니터링은 이 런북의 대상이 아니다.
