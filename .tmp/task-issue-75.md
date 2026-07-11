# issue #75 タスクリスト

- [x] 1. ブランチ `feature/template-vars-pr-info` を作成
- [x] 2. `server/src/preview/service.ts`: `BuildTarget.templateVars` を追加し
      `resolveBuildTarget()` で PR_NUMBER / PR_TITLE / PROFILE_NAME を組み立て、
      `buildPreview()` でマージ。`resolveBuildTarget` を export
- [x] 3. `overlay.ts` / `rewrite.ts` のJSDocの変数列挙を更新
- [x] 4. `README.md` に新変数を追記
- [x] 5. テスト `server/test/preview/service.test.ts` を追加(4件)
- [x] 6. テスト実行(74件パス)・フォーマッタ適用・型チェック(エラーなし)
- [ ] 7. コミットせずユーザーへ確認
