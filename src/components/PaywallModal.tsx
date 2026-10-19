import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import Constants from "expo-constants";

import {
  appNetworkId,
  sorobanRpcUrl,
  prepareResourceAccess,
  signPaymentTransaction,
  submitSignedPayment,
  type PaymentChallenge,
} from "../api/payment";
import { DEFAULT_STELLAR_NETWORK } from "../api/resources";
import { spacing } from "../theme";
import type { ThemeColors } from "../theme";
import { useAppTheme } from "../theme/ThemeProvider";
import type { AccessResult } from "../types";
import { SignTransactionSheet } from "./SignTransactionSheet";

interface PaywallModalProps {
  visible: boolean;
  accessUrl: string;
  resourceTitle: string;
  price: string;
  onClose: () => void;
}

type Phase = "confirm" | "preparing" | "signing" | "authorizing" | "settling" | "result" | "error";

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: "80%",
      paddingBottom: spacing.xxl,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: spacing.lg,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    closeBtn: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    closeBtnText: {
      fontSize: 16,
      color: colors.textMuted,
    },
    title: { flex: 1, flexShrink: 1 },
    body: {
      padding: spacing.lg,
      gap: spacing.md,
    },
    centered: {
      alignItems: "center",
      paddingVertical: spacing.xxl,
    },
    actionBtn: {
      alignItems: "center",
      paddingVertical: 12,
    },
    hint: {
      fontSize: 12,
      color: colors.textMuted,
    },
    scrollArea: {
      flexGrow: 0,
    },
    scrollContent: {
      padding: spacing.lg,
    },
    contentText: {
      fontSize: 14,
      color: colors.text,
      lineHeight: 22,
    },
  });
}

function paymentNetworkLabel(): string {
  try {
    return appNetworkId() === "stellar:pubnet" ? "Stellar mainnet" : "Stellar testnet";
  } catch {
    // Unsupported configurations are reported by the payment request, not by
    // rendering a resource detail screen with an unopened modal.
    return `Stellar ${DEFAULT_STELLAR_NETWORK}`;
  }
}

export function PaywallModal({
  visible,
  accessUrl,
  resourceTitle,
  price,
  onClose,
}: PaywallModalProps) {
  const { colors, shared, typography } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [phase, setPhase] = useState<Phase>("confirm");
  const [result, setResult] = useState<AccessResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<PaymentChallenge | null>(null);

  const flow = useRef(0);
  const busy = useRef(false);
  const networkLabel = paymentNetworkLabel();

  useEffect(() => {
    flow.current += 1;
    busy.current = false;
    setPhase("confirm");
    setResult(null);
    setErrorMsg(null);
    setChallenge(null);
    return () => { flow.current += 1; };
  }, [visible, accessUrl, price, resourceTitle]);

  function isActive(run: number) {
    return visible && flow.current === run;
  }

  function close() {
    flow.current += 1;
    busy.current = false;
    setChallenge(null);
    setPhase("confirm");
    onClose();
  }

  function showError(err: unknown, run: number) {
    if (!isActive(run)) return;
    busy.current = false;
    setChallenge(null);
    setErrorMsg(err instanceof Error ? err.message : "Unable to access this resource. Please try again.");
    setPhase("error");
  }

  async function showResult(access: AccessResult, run: number) {
    if (!isActive(run)) return;
    setResult(access);
    if (access.type === "external") {
      await Linking.openURL(access.url);
      if (isActive(run)) close();
    } else {
      setPhase("result");
    }
  }

  async function handlePay() {
    if (!visible || busy.current) return;
    const run = ++flow.current;
    busy.current = true;
    setErrorMsg(null);
    setResult(null);
    setPhase("preparing");
    try {
      const access = await prepareResourceAccess(accessUrl, price);
      if (!isActive(run)) return;
      if (access.type === "payment") {
        setChallenge(access.challenge);
        setPhase("signing");
      } else {
        await showResult(access.result, run);
      }
    } catch (err) {
      showError(err, run);
    } finally {
      if (isActive(run)) busy.current = false;
    }
  }

  async function handleSigned(transaction: string, run: number, payment: PaymentChallenge) {
    // A signature that finishes after Close/Cancel must never settle a payment.
    if (!isActive(run) || busy.current) return;
    busy.current = true;
    setChallenge(null);
    setPhase("settling");
    try {
      const access = await submitSignedPayment(accessUrl, payment, transaction);
      await showResult(access, run);
    } catch (err) {
      showError(err, run);
    } finally {
      if (isActive(run)) busy.current = false;
    }
  }

  const signingRun = flow.current;

  return (
    <>
      <Modal
        visible={visible && phase !== "signing"}
        animationType="slide"
        transparent
        onRequestClose={close}
        accessibilityViewIsModal
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={[typography.cardTitle, styles.title]} numberOfLines={2}>
                {resourceTitle}
              </Text>
              <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close payment" style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </Pressable>
            </View>

            {phase === "confirm" && (
              <View style={styles.body}>
                <Text style={typography.body}>
                  This resource requires a payment of{" "}
                  <Text style={{ fontWeight: "700", color: colors.primary }}>
                    {price} USDC
                  </Text>{" "}
                  on {networkLabel} to access.
                </Text>
                <Text style={styles.hint}>
                  You'll sign the payment with your Stellar key; the server pays the network fee.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void handlePay()}
                  style={[shared.button, shared.primaryButton, styles.actionBtn]}
                >
                  <Text style={[shared.buttonText, shared.primaryButtonText]}>
                    Pay &amp; Access
                  </Text>
                </Pressable>
              </View>
            )}

            {(["preparing", "authorizing", "settling"] as Phase[]).includes(phase) && (
              <View style={[styles.body, styles.centered]}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={typography.body} accessibilityRole="progressbar" accessibilityLiveRegion="polite">
                  {phase === "preparing" ? "Getting payment challenge…" : phase === "authorizing" ? "Signing payment…" : "Settling payment…"}
                </Text>
              </View>
            )}

            {phase === "result" && result?.type === "text" && (
              <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
                <Text style={styles.contentText}>{result.content}</Text>
              </ScrollView>
            )}

            {phase === "error" && (
              <View style={styles.body}>
                <Text accessibilityRole="alert" style={[typography.body, { color: colors.danger }]}>{errorMsg}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    if (result?.type === "external") {
                      const run = flow.current;
                      setPhase("settling");
                      void showResult(result, run).catch((err: unknown) => showError(err, run));
                    } else {
                      void handlePay();
                    }
                  }}
                  style={[shared.button, shared.primaryButton, styles.actionBtn]}
                >
                  <Text style={[shared.buttonText, shared.primaryButtonText]}>Retry</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>
      {visible && phase === "signing" && challenge ? (
        <SignTransactionSheet
          visible
          unsignedXdr=""
          sign={async (secret) => {
            if (!isActive(signingRun)) throw new Error("Payment cancelled.");
            // Show progress with a working Close action while simulation/signing
            // is pending. Unmounting the key sheet also clears its local state.
            setPhase("authorizing");
            try {
              const transaction = await signPaymentTransaction(
                challenge, secret, sorobanRpcUrl(Constants.expoConfig?.extra?.sorobanRpcUrl)
              );
              if (!isActive(signingRun)) throw new Error("Payment cancelled.");
              return transaction;
            } catch (err) {
              showError(err, signingRun);
              throw err;
            }
          }}
          onCancel={close}
          onSigned={(transaction) => handleSigned(transaction, signingRun, challenge)}
        />
      ) : null}
    </>
  );
}
