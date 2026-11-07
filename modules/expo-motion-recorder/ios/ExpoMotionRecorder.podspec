Pod::Spec.new do |s|
  s.name           = 'ExpoMotionRecorder'
  s.version        = '1.0.0'
  s.summary        = 'CMSensorRecorder-backed retro verification for phone-down sessions'
  s.description    = 'Records accelerometer while suspended so backgrounded intervals can be classified'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
