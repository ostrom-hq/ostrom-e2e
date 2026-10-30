// ostrom.coverage — precompiled script plugin for every Kotlin Multiplatform module of Ostrom.
//
// Copy into build-logic/src/main/kotlin/ (or apply the same lines in the module's build file) and apply it in every
// module next to the multiplatform plugin. build-logic needs, on its classpath:
//     implementation("org.jetbrains.kotlinx:kover-gradle-plugin:0.9.11")
//
// Why a JVM target in a native product: Kover cannot measure Kotlin/Native. The product ships native binaries only;
// this `jvm()` target exists so that commonMain is executed and measured on the JVM. It is never published, never
// packaged and never run in production. Native-only code (nativeMain, cinterop, processes, PTY, keychain) stays thin
// and is covered by the linuxX64 tests and the end-to-end bench (ostrom-e2e).
//
// Rule (Lyes, 30/10/2026): 100 % of lines AND branches, enforced by `koverVerify` in CI. The only exclusion is the
// `@ExcludeFromCoverage` annotation, and each use carries a one-line justification right above it, read in review.

import kotlinx.kover.gradle.plugin.dsl.CoverageUnit

plugins {
    id("org.jetbrains.kotlin.multiplatform")
    id("org.jetbrains.kotlinx.kover")
}

kotlin {
    // Test-only target (see above). Never shipped.
    jvm()
}

kover {
    reports {
        filters {
            excludes {
                // Each use must have a `// coverage: <why>` line right above it; reviewers reject it otherwise.
                annotatedBy("*.ExcludeFromCoverage")
            }
        }
        verify {
            rule("100 % of lines and branches (Lyes, 30/10/2026)") {
                minBound(100, CoverageUnit.LINE)
                minBound(100, CoverageUnit.BRANCH)
            }
        }
    }
}

// The jvm target exists for tests only: never publish it.
tasks.matching { it.name.contains("JvmPublication") }.configureEach { enabled = false }
