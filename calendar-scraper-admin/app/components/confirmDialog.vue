<!-- components/ConfirmDialog.vue -->
<template>
  <div v-if="modelValue" class="modal">
    <div class="modal-content">
      <h3>{{ title }}</h3>
      <p>{{ message }}</p>
      <div class="actions">
        <button @click="$emit('update:modelValue', false)">Cancel</button>
        <button @click="$emit('confirm')">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps(['modelValue', 'title', 'message', 'confirmText'])
defineEmits(['update:modelValue', 'confirm'])
</script>

<style scoped>
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-content {
  background: white;
  padding: 20px;
  border-radius: 8px;
}
.actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
</style>